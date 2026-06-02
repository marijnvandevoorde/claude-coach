/**
 * Garmin Connect client — token management + authenticated HTTP, in TypeScript.
 *
 * Talks to Garmin Connect using the OAuth2 ("diauth") tokens stored in
 * $GARMINTOKENS (a `garmin_tokens.json` with di_token / di_refresh_token /
 * di_client_id, minted once by `garmin-mcp-auth`). Access tokens are short-lived,
 * so we refresh on every `create()` and persist the rotated refresh token back —
 * the client stays alive for months without any re-auth or password.
 *
 * Uses only Node built-ins (global `fetch`, `node:fs`) — no third-party deps,
 * so the runtime image needs nothing but Node. This replaces the old
 * `scripts/garmin_fetch.py` (which did the same over Python's urllib).
 */
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DIAUTH = "https://diauth.garmin.com/di-oauth2-service/oauth/token";
const API = "https://connectapi.garmin.com";
const APP_UA = "com.garmin.android.apps.connectmobile"; // for the token refresh
const API_UA = "GCM-iOS-5.7.2.1"; // connectapi rejects unknown clients

export interface GarminTokens {
  di_token?: string;
  di_refresh_token: string;
  di_client_id: string;
  [k: string]: unknown;
}

interface RefreshResponse {
  access_token?: string;
  refresh_token?: string;
}

/** Resolve the token file: $GARMINTOKENS may be a dir (→ garmin_tokens.json) or the file itself. */
export function tokenPath(): string {
  const store = process.env.GARMINTOKENS || join(homedir(), ".garminconnect");
  try {
    if (existsSync(store) && statSync(store).isDirectory()) {
      return join(store, "garmin_tokens.json");
    }
  } catch {
    /* fall through to treating it as a file path */
  }
  return store;
}

export function loadTokens(path = tokenPath()): GarminTokens {
  const tokens = JSON.parse(readFileSync(path, "utf-8")) as GarminTokens;
  for (const k of ["di_refresh_token", "di_client_id"] as const) {
    if (!tokens[k]) throw new Error(`missing ${k} (expected a garmin_tokens.json)`);
  }
  return tokens;
}

async function refreshAccess(tokens: GarminTokens): Promise<RefreshResponse> {
  const res = await fetch(DIAUTH, {
    method: "POST",
    headers: { "User-Agent": APP_UA, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.di_refresh_token,
      client_id: tokens.di_client_id,
    }),
  });
  if (!res.ok) throw new Error(`refresh: HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
  return (await res.json()) as RefreshResponse;
}

/** Cache the latest access token + rotate the refresh token (best effort). */
function persist(path: string, tokens: GarminTokens, refreshed: RefreshResponse): void {
  try {
    const updated: GarminTokens = { ...tokens };
    if (refreshed.access_token) updated.di_token = refreshed.access_token;
    if (refreshed.refresh_token) updated.di_refresh_token = refreshed.refresh_token;
    writeFileSync(path, JSON.stringify(updated));
  } catch {
    /* best effort — a read-only token store still works for this run */
  }
}

/** An authenticated Garmin Connect client. Build with `GarminClient.create()`. */
export class GarminClient {
  private constructor(private readonly access: string) {}

  static async create(): Promise<GarminClient> {
    const path = tokenPath();
    const tokens = loadTokens(path);
    const refreshed = await refreshAccess(tokens);
    if (!refreshed.access_token) throw new Error("refresh: no access_token in response");
    persist(path, tokens, refreshed);
    return new GarminClient(refreshed.access_token);
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return { Authorization: `Bearer ${this.access}`, "User-Agent": API_UA, NK: "NT", ...extra };
  }

  /** GET a connectapi path. Returns parsed JSON, or null on an empty body. Throws on non-2xx. */
  async get<T = unknown>(path: string): Promise<T | null> {
    const res = await fetch(API + path, { headers: this.headers() });
    if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
    const text = await res.text();
    return text ? (JSON.parse(text) as T) : null;
  }

  /** POST JSON to a connectapi path. Returns parsed JSON (or null). Throws on non-2xx. */
  async post<T = unknown>(path: string, body: unknown): Promise<T | null> {
    const res = await fetch(API + path, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    if (!res.ok)
      throw new Error(`POST ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const text = await res.text();
    return text ? (JSON.parse(text) as T) : null;
  }

  /** DELETE a connectapi path. Throws on non-2xx (204 No Content is fine). */
  async del(path: string): Promise<void> {
    const res = await fetch(API + path, { method: "DELETE", headers: this.headers() });
    if (!res.ok && res.status !== 204) throw new Error(`DELETE ${path}: HTTP ${res.status}`);
  }
}
