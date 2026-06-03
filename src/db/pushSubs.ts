import { execute, queryJson } from "./client.js";
import { getDialect } from "./dialect.js";

// ============================================================================
// Web Push (PWA) subscriptions
//
// One row per browser/device subscription (keyed by its push endpoint URL).
// Stored so the cron / CLI can fan reminders out to installed PWAs in addition
// to the Home Assistant webhook. See src/lib/webpush.ts for the send path.
// ============================================================================

function esc(value: string | null | undefined): string {
  if (value == null) return "NULL";
  return `'${value.replace(/'/g, "''")}'`;
}

export interface PushSub {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Upsert a subscription (idempotent — re-subscribing the same endpoint is fine). */
export async function saveSubscription(sub: PushSub, userAgent?: string | null): Promise<void> {
  const dialect = getDialect();
  await execute(
    dialect.upsert(
      "push_subscriptions",
      ["endpoint", "p256dh", "auth", "user_agent", "created_at"],
      `(${esc(sub.endpoint)}, ${esc(sub.p256dh)}, ${esc(sub.auth)}, ${esc(userAgent ?? null)}, ${dialect.now()})`,
      "endpoint",
      ["p256dh", "auth", "user_agent"]
    )
  );
}

export async function listSubscriptions(): Promise<PushSub[]> {
  return queryJson<PushSub>(`SELECT endpoint, p256dh, auth FROM push_subscriptions;`);
}

export async function countSubscriptions(): Promise<number> {
  const rows = await queryJson<{ n: number }>(`SELECT COUNT(*) AS n FROM push_subscriptions;`);
  return Number(rows[0]?.n ?? 0);
}

/** Remove a subscription (e.g. the push service reported it gone, or the user opted out). */
export async function deleteSubscription(endpoint: string): Promise<void> {
  await execute(`DELETE FROM push_subscriptions WHERE endpoint = ${esc(endpoint)};`);
}

/** Mark a subscription as recently delivered-to (for observability). */
export async function touchSubscription(endpoint: string): Promise<void> {
  await execute(
    `UPDATE push_subscriptions SET last_ok_at = ${getDialect().now()} WHERE endpoint = ${esc(endpoint)};`
  );
}
