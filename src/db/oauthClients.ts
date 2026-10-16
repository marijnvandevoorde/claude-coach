import { existsSync, readFileSync } from "node:fs";
import { execute, queryJson } from "./client.js";
import { getDialect } from "./dialect.js";

// ============================================================================
// MCP OAuth clients (dynamic client registration, RFC 7591)
//
// One row per registered client: its id and the redirect URIs it may use.
// Kept in the DB so coach-mcp needs no writable volume (it used to be an
// oauth-clients.json next to coach.db).
// ============================================================================

export interface OAuthClient {
  client_id: string;
  redirect_uris: string[];
}

function esc(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export async function saveOAuthClient(c: OAuthClient): Promise<void> {
  await execute(
    `${getDialect().replaceVerb()} INTO oauth_clients (client_id, redirect_uris, created_at) ` +
      `VALUES (${esc(c.client_id)}, ${esc(JSON.stringify(c.redirect_uris))}, ${Date.now()});`
  );
}

export async function getOAuthClient(clientId: string): Promise<OAuthClient | null> {
  const rows = await queryJson<{ client_id: string; redirect_uris: string }>(
    `SELECT client_id, redirect_uris FROM oauth_clients WHERE client_id = ${esc(clientId)} LIMIT 1;`
  );
  const r = rows[0];
  if (!r) return null;
  try {
    const uris = JSON.parse(r.redirect_uris) as unknown;
    return { client_id: r.client_id, redirect_uris: Array.isArray(uris) ? (uris as string[]) : [] };
  } catch {
    return { client_id: r.client_id, redirect_uris: [] };
  }
}

export async function countOAuthClients(): Promise<number> {
  const rows = await queryJson<{ n: number }>(`SELECT COUNT(*) AS n FROM oauth_clients;`);
  return Number(rows[0]?.n ?? 0);
}

/** One-time import of a legacy oauth-clients.json ({id: {client_id, redirect_uris}}).
 *  Existing rows are kept. Returns how many clients were newly imported. */
export async function importLegacyOAuthClients(path: string): Promise<number> {
  if (!existsSync(path)) return 0;
  const data = JSON.parse(readFileSync(path, "utf-8")) as Record<string, Partial<OAuthClient>>;
  let added = 0;
  for (const [id, c] of Object.entries(data)) {
    const uris = Array.isArray(c?.redirect_uris) ? c.redirect_uris : [];
    if (!uris.length || (await getOAuthClient(id))) continue;
    await saveOAuthClient({ client_id: id, redirect_uris: uris });
    added++;
  }
  return added;
}
