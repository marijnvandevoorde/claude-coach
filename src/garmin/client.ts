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
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execute, queryJson } from "../db/client.js";
import { getDialect } from "../db/dialect.js";

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
  expires_in?: number; // access-token lifetime in seconds (Garmin ~ 3600)
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

async function refreshAccess(refreshToken: string, clientId: string): Promise<RefreshResponse> {
  const res = await fetch(DIAUTH, {
    method: "POST",
    headers: { "User-Agent": APP_UA, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
    }),
  });
  if (!res.ok) throw new Error(`refresh: HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
  return (await res.json()) as RefreshResponse;
}

/** Cache the latest access token + rotate the refresh token (best effort).
 * Writes atomically (tmp + rename) so a concurrent reader never sees a torn file. */
function persist(path: string, tokens: GarminTokens, refreshed: RefreshResponse): void {
  try {
    const updated: GarminTokens = { ...tokens };
    if (refreshed.access_token) updated.di_token = refreshed.access_token;
    if (refreshed.refresh_token) updated.di_refresh_token = refreshed.refresh_token;
    const tmp = `${path}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(updated));
    renameSync(tmp, path);
  } catch {
    /* best effort — a read-only token store still works for this run */
  }
}

// ============================================================================
// Shared OAuth token store (DB-backed) — fixes the multi-process refresh race.
//
// Garmin rotates the refresh token on every refresh (single-use). The cron, MCP,
// web app, and backfills all run this client, so two near-simultaneous refreshes
// race and the loser gets `invalid_grant` — and a poisoned token then breaks
// every later refresh. Fix: keep the live access/refresh token in ONE DB row
// shared by all processes, refresh only when the access token is actually
// expired (≈hourly, not per call), and serialize that rare refresh with a
// lease-lock row (atomic `UPDATE … WHERE locked_until < now` — works across
// containers and pooled connections, unlike per-connection MySQL GET_LOCK). The
// token file is now only a seed: di_client_id + first-run / re-auth bootstrap.
// ============================================================================

const SKEW_MS = 120_000; // treat the access token as stale 2 min before expiry
const LEASE_MS = 25_000; // max time one process may hold the refresh lock
let refreshCounter = 0;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
function sqlStr(v: string | null): string {
  return v == null ? "NULL" : `'${v.replace(/'/g, "''")}'`;
}

interface OAuthState {
  access_token: string | null;
  refresh_token: string | null;
  expires_at: number | null;
}

/** True if the DB + the token table are reachable (else we fall back to the file). */
async function dbReady(): Promise<boolean> {
  try {
    await queryJson(`SELECT id FROM garmin_oauth LIMIT 1;`);
    return true;
  } catch {
    return false;
  }
}

async function readOAuth(): Promise<OAuthState | null> {
  const rows = await queryJson<OAuthState>(
    `SELECT access_token, refresh_token, expires_at FROM garmin_oauth WHERE id = 1 LIMIT 1;`
  );
  const r = rows[0];
  if (!r) return null;
  return {
    access_token: r.access_token ?? null,
    refresh_token: r.refresh_token ?? null,
    expires_at: r.expires_at != null ? Number(r.expires_at) : null,
  };
}

/** Seed the single token row from the file when missing/empty (first run). */
async function seedOAuth(file: GarminTokens): Promise<void> {
  if ((await readOAuth())?.refresh_token) return;
  await execute(
    `${getDialect().replaceVerb()} INTO garmin_oauth (id, access_token, refresh_token, expires_at) ` +
      `VALUES (1, ${sqlStr(file.di_token ?? null)}, ${sqlStr(file.di_refresh_token)}, 0);`
  );
}

async function writeOAuth(access: string, refresh: string, expiresAt: number): Promise<void> {
  await execute(
    `UPDATE garmin_oauth SET access_token = ${sqlStr(access)}, refresh_token = ${sqlStr(refresh)}, ` +
      `expires_at = ${Math.round(expiresAt)}, updated_at = ${getDialect().now()} WHERE id = 1;`
  );
}

/** The cached access token if it's still comfortably valid, else null. */
function fresh(s: OAuthState | null): string | null {
  return s?.access_token && (s.expires_at ?? 0) > Date.now() + SKEW_MS ? s.access_token : null;
}

/** Atomically claim the refresh lease. Returns true if we now own it. */
async function acquireLease(owner: string): Promise<boolean> {
  const now = Date.now();
  await execute(
    `UPDATE garmin_oauth SET lock_owner = ${sqlStr(owner)}, locked_until = ${now + LEASE_MS} ` +
      `WHERE id = 1 AND (locked_until IS NULL OR locked_until < ${now});`
  );
  const rows = await queryJson<{ lock_owner: string | null }>(
    `SELECT lock_owner FROM garmin_oauth WHERE id = 1 LIMIT 1;`
  );
  return rows[0]?.lock_owner === owner;
}

async function releaseLease(owner: string): Promise<void> {
  try {
    await execute(
      `UPDATE garmin_oauth SET lock_owner = NULL, locked_until = NULL WHERE id = 1 AND lock_owner = ${sqlStr(owner)};`
    );
  } catch {
    /* the lease expires on its own */
  }
}

/** Refresh once and persist. On invalid_grant, if the file holds a *different*
 *  refresh token (the user re-minted tokens), retry with it to self-recover. */
async function refreshAndStore(refreshToken: string, file: GarminTokens): Promise<string> {
  const store = async (r: RefreshResponse, used: string): Promise<string> => {
    if (!r.access_token) throw new Error("refresh: no access_token in response");
    await writeOAuth(
      r.access_token,
      r.refresh_token ?? used,
      Date.now() + (r.expires_in ?? 3600) * 1000
    );
    return r.access_token;
  };
  try {
    return await store(await refreshAccess(refreshToken, file.di_client_id), refreshToken);
  } catch (e) {
    const reauth = file.di_refresh_token && file.di_refresh_token !== refreshToken;
    if (reauth && /invalid_grant|invalid refresh|HTTP 400/i.test(String(e))) {
      return store(
        await refreshAccess(file.di_refresh_token, file.di_client_id),
        file.di_refresh_token
      );
    }
    throw e;
  }
}

/** A valid access token from the shared DB store — refresh only when expired,
 *  serialized across processes by the lease lock. */
async function dbAccessToken(file: GarminTokens): Promise<string> {
  await seedOAuth(file);
  const cached = fresh(await readOAuth());
  if (cached) return cached;

  const owner = `${process.pid}-${Date.now()}-${refreshCounter++}`;
  for (let attempt = 0; attempt < 8; attempt++) {
    if (await acquireLease(owner)) {
      try {
        const cur = await readOAuth(); // double-check: someone may have just refreshed
        return (
          fresh(cur) ?? (await refreshAndStore(cur?.refresh_token || file.di_refresh_token, file))
        );
      } finally {
        await releaseLease(owner);
      }
    }
    // Another process holds the lease — wait, then see if it published a fresh token.
    await sleep(350 + attempt * 250);
    const ok = fresh(await readOAuth());
    if (ok) return ok;
  }
  // Lease never freed and no fresh token appeared — refresh anyway (best effort).
  const cur = await readOAuth();
  return refreshAndStore(cur?.refresh_token || file.di_refresh_token, file);
}

/** File-only fallback when the DB is unreachable: the legacy load→refresh→persist
 *  with a small retry for the shared-file race. */
async function fileAccessToken(file: GarminTokens, path: string): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const tokens = attempt === 0 ? file : loadTokens(path);
    try {
      const refreshed = await refreshAccess(tokens.di_refresh_token, tokens.di_client_id);
      if (!refreshed.access_token) throw new Error("refresh: no access_token in response");
      persist(path, tokens, refreshed);
      return refreshed.access_token;
    } catch (e) {
      lastErr = e;
      if (attempt === 2 || !/invalid_grant|invalid refresh|HTTP 400/i.test(String(e))) throw e;
      await sleep(500 + attempt * 750);
    }
  }
  throw lastErr;
}

async function getValidAccessToken(): Promise<string> {
  const path = tokenPath();
  const file = loadTokens(path);
  return (await dbReady()) ? dbAccessToken(file) : fileAccessToken(file, path);
}

/** An authenticated Garmin Connect client. Build with `GarminClient.create()`. */
export class GarminClient {
  private constructor(private readonly access: string) {}

  static async create(): Promise<GarminClient> {
    return new GarminClient(await getValidAccessToken());
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return { Authorization: `Bearer ${this.access}`, "User-Agent": API_UA, NK: "NT", ...extra };
  }

  /** fetch() with exponential backoff on HTTP 429 (Garmin rate-limits bursts). */
  private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    const maxRetries = 5;
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, init);
      if (res.status !== 429 || attempt >= maxRetries) return res;
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitMs =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(1000 * 2 ** attempt, 16000);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }

  /** GET a connectapi path. Returns parsed JSON, or null on an empty body. Throws on non-2xx. */
  async get<T = unknown>(path: string): Promise<T | null> {
    const res = await this.fetchWithRetry(API + path, { headers: this.headers() });
    if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
    const text = await res.text();
    return text ? (JSON.parse(text) as T) : null;
  }

  /** GET a connectapi path expecting a non-JSON body (e.g. a GPX/XML export). Returns raw text. */
  async getText(path: string): Promise<string> {
    const res = await this.fetchWithRetry(API + path, { headers: this.headers() });
    if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
    return await res.text();
  }

  /** POST JSON to a connectapi path. Returns parsed JSON (or null). Throws on non-2xx. */
  async post<T = unknown>(path: string, body: unknown): Promise<T | null> {
    const res = await this.fetchWithRetry(API + path, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    if (!res.ok)
      throw new Error(`POST ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const text = await res.text();
    return text ? (JSON.parse(text) as T) : null;
  }

  /** PUT JSON to a connectapi path (update). Returns parsed JSON (or null). Throws on non-2xx. */
  async put<T = unknown>(path: string, body: unknown): Promise<T | null> {
    const res = await this.fetchWithRetry(API + path, {
      method: "PUT",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    if (!res.ok)
      throw new Error(`PUT ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const text = await res.text();
    return text ? (JSON.parse(text) as T) : null;
  }

  /** DELETE a connectapi path. Throws on non-2xx (204 No Content is fine). */
  async del(path: string): Promise<void> {
    const res = await this.fetchWithRetry(API + path, {
      method: "DELETE",
      headers: this.headers(),
    });
    if (!res.ok && res.status !== 204) throw new Error(`DELETE ${path}: HTTP ${res.status}`);
  }
}
