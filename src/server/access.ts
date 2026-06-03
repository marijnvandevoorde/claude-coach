/**
 * Cloudflare Zero Trust Access verification for the coach-app (/app + /api).
 *
 * In production the route sits behind a Cloudflare Access application; Access
 * injects a `Cf-Access-Jwt-Assertion` header. We verify it at the ORIGIN too
 * (against the team's Access JWKS + the app's AUD) and re-check the email
 * allowlist, so a request that bypasses Cloudflare and hits the origin directly
 * is still rejected. The /mcp route keeps its own (separate) OAuth.
 *
 * Config (all required to ENABLE enforcement):
 *   COACH_ACCESS_TEAM_DOMAIN   e.g. https://small-victories.cloudflareaccess.com
 *   COACH_ACCESS_AUD           the Access application's AUD tag
 *   COACH_OAUTH_ALLOWED_EMAILS comma-separated allowlist (reused from the MCP)
 *
 * When TEAM_DOMAIN/AUD are unset, enforcement is OFF (open) — for local dev and
 * because in prod the origin is only reachable through Cloudflare anyway.
 */
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Request, Response, NextFunction } from "express";

const TEAM = process.env.COACH_ACCESS_TEAM_DOMAIN;
const AUD = process.env.COACH_ACCESS_AUD;

export function allowedEmails(): string[] {
  return (process.env.COACH_OAUTH_ALLOWED_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** True once the email passes the allowlist (empty allowlist = allow any authenticated email). */
export function emailAllowed(email: string): boolean {
  const list = allowedEmails();
  return list.length === 0 || list.includes(email.trim().toLowerCase());
}

/** Enforcement is on only when both the team domain and the app AUD are configured. */
export function accessEnabled(): boolean {
  return Boolean(TEAM && AUD);
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks(): ReturnType<typeof createRemoteJWKSet> | null {
  if (!jwks && TEAM) jwks = createRemoteJWKSet(new URL(`${TEAM}/cdn-cgi/access/certs`));
  return jwks;
}

/** Verify a Cloudflare Access JWT; returns the verified email or null. */
export async function verifyAccess(jwt: string | undefined): Promise<{ email: string } | null> {
  if (!jwt || !AUD) return null;
  const ks = getJwks();
  if (!ks) return null;
  try {
    const { payload } = await jwtVerify(jwt, ks, { issuer: TEAM, audience: AUD });
    const email = String(payload.email ?? "").toLowerCase();
    if (!email || !emailAllowed(email)) return null;
    return { email };
  } catch {
    return null;
  }
}

export interface AuthedRequest extends Request {
  userEmail?: string;
}

/** Express middleware enforcing Cloudflare Access (no-op when not configured). */
export function accessMiddleware() {
  return async (req: AuthedRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!accessEnabled()) {
      next();
      return;
    }
    const user = await verifyAccess(req.header("Cf-Access-Jwt-Assertion"));
    if (!user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    req.userEmail = user.email;
    next();
  };
}
