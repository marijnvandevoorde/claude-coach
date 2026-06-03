/**
 * Minimal OAuth 2.0 Authorization Server for coach-mcp, federating login to Google.
 * Implements just enough of the MCP authorization spec for Claude clients:
 *   - discovery (.well-known/oauth-authorization-server + oauth-protected-resource)
 *   - dynamic client registration (Claude auto-registers; no manual client id)
 *   - authorization code + PKCE, where the user logs in via Google
 *   - token endpoint issuing a signed JWT access token
 *   - access-token verification for the /mcp endpoint
 *
 * Enable by setting (see DEPLOYMENT.md):
 *   COACH_OAUTH_ISSUER=https://coach.example.com     (this server's public base URL)
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET           (a Google OAuth "Web application" client)
 *   COACH_OAUTH_ALLOWED_EMAILS=you@example.com       (comma-separated allowlist)
 *   COACH_OAUTH_SIGNING_SECRET=<long random>         (signs our access tokens)
 * The Google client's authorized redirect URI must be: <ISSUER>/oauth/google/callback
 */
import { Router } from "express";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { SignJWT, jwtVerify, createRemoteJWKSet } from "jose";

const ISSUER = (process.env.COACH_OAUTH_ISSUER || "").replace(/\/$/, "");
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const ALLOWED_EMAILS = (process.env.COACH_OAUTH_ALLOWED_EMAILS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const SIGNING_SECRET = process.env.COACH_OAUTH_SIGNING_SECRET || "";
const CLIENTS_FILE = (process.env.COACH_DB_PATH || "/data/coach.db").replace(
  /[^/]+$/,
  "oauth-clients.json"
);

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export function oauthEnabled(): boolean {
  return Boolean(
    ISSUER && GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && SIGNING_SECRET && ALLOWED_EMAILS.length
  );
}

export function resourceMetadataUrl(): string {
  return `${ISSUER}/.well-known/oauth-protected-resource`;
}

const key = () => new TextEncoder().encode(SIGNING_SECRET);
const sha256url = (s: string) => createHash("sha256").update(s).digest("base64url");
const rand = (n = 32) => randomBytes(n).toString("base64url");

// --- storage: clients persisted to disk, codes/logins in-memory (short-lived) ---
interface Client {
  client_id: string;
  redirect_uris: string[];
}
function loadClients(): Record<string, Client> {
  try {
    return existsSync(CLIENTS_FILE) ? JSON.parse(readFileSync(CLIENTS_FILE, "utf-8")) : {};
  } catch {
    return {};
  }
}
function saveClients(c: Record<string, Client>): void {
  try {
    mkdirSync(dirname(CLIENTS_FILE), { recursive: true });
    writeFileSync(CLIENTS_FILE, JSON.stringify(c));
  } catch {
    /* best effort */
  }
}
const clients = loadClients();

interface Code {
  client_id: string;
  redirect_uri: string;
  challenge: string;
  email: string;
  exp: number;
}
const codes = new Map<string, Code>();
interface Login {
  client_id: string;
  redirect_uri: string;
  challenge: string;
  clientState: string;
  exp: number;
}
const logins = new Map<string, Login>();
function gc(): void {
  const now = Date.now();
  for (const [k, v] of codes) if (v.exp < now) codes.delete(k);
  for (const [k, v] of logins) if (v.exp < now) logins.delete(k);
}

/** Verify an access token presented to /mcp. Returns the subject email or null. */
export async function verifyAccessToken(authHeader?: string): Promise<{ email: string } | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  try {
    const { payload } = await jwtVerify(authHeader.slice(7), key(), {
      issuer: ISSUER,
      audience: ISSUER,
    });
    return { email: String(payload.sub) };
  } catch {
    return null;
  }
}

export function oauthRouter(): Router {
  const r = Router();

  r.get("/.well-known/oauth-protected-resource", (_req, res) => {
    res.json({ resource: ISSUER, authorization_servers: [ISSUER] });
  });

  r.get("/.well-known/oauth-authorization-server", (_req, res) => {
    res.json({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/oauth/authorize`,
      token_endpoint: `${ISSUER}/oauth/token`,
      registration_endpoint: `${ISSUER}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["openid", "email", "profile", "mcp"],
    });
  });

  // Dynamic client registration (RFC 7591) — lets Claude register itself.
  r.post("/oauth/register", (req, res) => {
    const body = (req.body ?? {}) as { redirect_uris?: unknown };
    const redirect_uris = Array.isArray(body.redirect_uris) ? (body.redirect_uris as string[]) : [];
    if (!redirect_uris.length) {
      res.status(400).json({ error: "invalid_redirect_uri" });
      return;
    }
    const client_id = rand(24);
    clients[client_id] = { client_id, redirect_uris };
    saveClients(clients);
    res.status(201).json({
      client_id,
      redirect_uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
    });
  });

  // Authorization endpoint -> bounce the user to Google.
  r.get("/oauth/authorize", (req, res) => {
    gc();
    const q = req.query as Record<string, string>;
    const client = q.client_id ? clients[q.client_id] : undefined;
    if (!client || !q.redirect_uri || !client.redirect_uris.includes(q.redirect_uri)) {
      res.status(400).send("invalid client_id / redirect_uri");
      return;
    }
    if (q.response_type !== "code" || q.code_challenge_method !== "S256" || !q.code_challenge) {
      res.status(400).send("invalid request (authorization code + PKCE S256 required)");
      return;
    }
    const loginState = rand();
    logins.set(loginState, {
      client_id: q.client_id,
      redirect_uri: q.redirect_uri,
      challenge: q.code_challenge,
      clientState: q.state || "",
      exp: Date.now() + 10 * 60 * 1000,
    });
    const g = new URL(GOOGLE_AUTH);
    g.searchParams.set("client_id", GOOGLE_CLIENT_ID);
    g.searchParams.set("redirect_uri", `${ISSUER}/oauth/google/callback`);
    g.searchParams.set("response_type", "code");
    g.searchParams.set("scope", "openid email profile");
    g.searchParams.set("state", loginState);
    g.searchParams.set("access_type", "online");
    g.searchParams.set("prompt", "select_account");
    res.redirect(g.toString());
  });

  // Google redirects back here -> verify email -> issue our authorization code.
  r.get("/oauth/google/callback", async (req, res) => {
    const q = req.query as Record<string, string>;
    const login = q.state ? logins.get(q.state) : undefined;
    if (!login) {
      res.status(400).send("unknown or expired login state");
      return;
    }
    logins.delete(q.state);
    try {
      const tok = await fetch(GOOGLE_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: q.code || "",
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: `${ISSUER}/oauth/google/callback`,
          grant_type: "authorization_code",
        }),
      });
      const tj = (await tok.json()) as { id_token?: string };
      if (!tj.id_token) {
        res.status(401).send("Google sign-in failed");
        return;
      }
      const { payload } = await jwtVerify(tj.id_token, GOOGLE_JWKS, {
        issuer: ["https://accounts.google.com", "accounts.google.com"],
        audience: GOOGLE_CLIENT_ID,
      });
      const email = String(payload.email || "").toLowerCase();
      if (!email || !ALLOWED_EMAILS.includes(email)) {
        res.status(403).send("This Google account isn't allowed.");
        return;
      }
      const ourCode = rand();
      codes.set(ourCode, {
        client_id: login.client_id,
        redirect_uri: login.redirect_uri,
        challenge: login.challenge,
        email,
        exp: Date.now() + 60 * 1000,
      });
      const back = new URL(login.redirect_uri);
      back.searchParams.set("code", ourCode);
      if (login.clientState) back.searchParams.set("state", login.clientState);
      res.redirect(back.toString());
    } catch {
      res.status(500).send("OAuth error");
    }
  });

  // Token endpoint: exchange our code (+ PKCE verifier) for a signed access token.
  r.post("/oauth/token", async (req, res) => {
    gc();
    const b = (req.body ?? {}) as Record<string, string>;
    if (b.grant_type !== "authorization_code") {
      res.status(400).json({ error: "unsupported_grant_type" });
      return;
    }
    const entry = b.code ? codes.get(b.code) : undefined;
    if (!entry || entry.exp < Date.now()) {
      res.status(400).json({ error: "invalid_grant" });
      return;
    }
    codes.delete(b.code);
    if (entry.client_id !== b.client_id || entry.redirect_uri !== b.redirect_uri) {
      res.status(400).json({ error: "invalid_grant" });
      return;
    }
    if (!b.code_verifier || sha256url(b.code_verifier) !== entry.challenge) {
      res.status(400).json({ error: "invalid_grant" });
      return;
    }
    // Long-lived by default (1 year): this is a single-user, email-allowlisted,
    // Cloudflare-fronted MCP, and we issue no refresh token — a 1h token forced a
    // full Google re-login every hour. Override with COACH_OAUTH_TOKEN_TTL_SECONDS.
    const ttl = Number(process.env.COACH_OAUTH_TOKEN_TTL_SECONDS || 31_536_000);
    const access_token = await new SignJWT({ scope: "mcp", email: entry.email })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(entry.email)
      .setIssuer(ISSUER)
      .setAudience(ISSUER)
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + ttl)
      .sign(key());
    res.json({ access_token, token_type: "Bearer", expires_in: ttl, scope: "mcp" });
  });

  return r;
}
