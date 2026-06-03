import webpush from "web-push";
import {
  listSubscriptions,
  deleteSubscription,
  touchSubscription,
  type PushSub,
} from "../db/pushSubs.js";

// ============================================================================
// Web Push delivery (PWA notifications)
//
// A second notification channel alongside the Home Assistant webhook: reminders
// fan out to every installed PWA that has subscribed. Uses VAPID auth — keys are
// supplied via env (COACH_VAPID_PUBLIC_KEY / COACH_VAPID_PRIVATE_KEY /
// COACH_VAPID_SUBJECT). Generate a pair once with `npx web-push generate-vapid-keys`.
// ============================================================================

let configured: boolean | null = null;

/** True when VAPID keys are present so web-push can sign/send. Memoized. */
export function webPushConfigured(): boolean {
  if (configured !== null) return configured;
  const pub = process.env.COACH_VAPID_PUBLIC_KEY;
  const priv = process.env.COACH_VAPID_PRIVATE_KEY;
  if (pub && priv) {
    webpush.setVapidDetails(
      process.env.COACH_VAPID_SUBJECT || "mailto:coach@small-victories.co",
      pub,
      priv
    );
    configured = true;
  } else {
    configured = false;
  }
  return configured;
}

/** The VAPID public key for the browser's PushManager.subscribe (or null). */
export function vapidPublicKey(): string | null {
  return process.env.COACH_VAPID_PUBLIC_KEY || null;
}

export interface WebPushResult {
  sent: number;
  failed: number;
  pruned: number;
  detail: string;
}

/** Send one notification to a single subscription. Returns the HTTP status code. */
async function sendOne(sub: PushSub, payload: string): Promise<number> {
  const res = await webpush.sendNotification(
    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
    payload
  );
  return res.statusCode;
}

/**
 * Fan a notification out to every stored PWA subscription. Best-effort: a single
 * subscription error never throws; 404/410 (gone) subscriptions are pruned so the
 * table self-cleans. Returns a tally for the delivery log.
 */
export async function sendWebPush(title: string, message: string): Promise<WebPushResult> {
  if (!webPushConfigured())
    return { sent: 0, failed: 0, pruned: 0, detail: "VAPID not configured" };
  const subs = await listSubscriptions();
  if (subs.length === 0) return { sent: 0, failed: 0, pruned: 0, detail: "no subscriptions" };

  const payload = JSON.stringify({ title, body: message, url: "/app/" });
  let sent = 0;
  let failed = 0;
  let pruned = 0;
  let lastErr = "";
  for (const sub of subs) {
    try {
      await sendOne(sub, payload);
      sent++;
      await touchSubscription(sub.endpoint);
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await deleteSubscription(sub.endpoint);
        pruned++;
      } else {
        failed++;
        lastErr = status ? `HTTP ${status}` : (e as Error).message;
      }
    }
  }
  const detail = `sent ${sent}, failed ${failed}, pruned ${pruned}${lastErr ? ` (${lastErr})` : ""}`;
  return { sent, failed, pruned, detail };
}
