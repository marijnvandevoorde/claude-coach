// Browser-side Web Push: register the service worker, subscribe via the VAPID
// public key, and hand the subscription to the server. Kept dependency-free.

const SW_URL = "/app/sw.js";
const SW_SCOPE = "/app/";

export type PushState = "unsupported" | "denied" | "off" | "on";

/** Web Push needs SW + PushManager + Notification. On iOS this only exists in an
 *  installed (home-screen) PWA, so absence here usually means "install first". */
export function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
}

/** Current push state without prompting. */
export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_SCOPE);
    const sub = await reg?.pushManager.getSubscription();
    return sub ? "on" : "off";
  } catch {
    return "off";
  }
}

interface PushConfig {
  enabled: boolean;
  publicKey: string | null;
  subscriptions: number;
}

/** Prompt for permission, subscribe, and persist the subscription server-side. */
export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  const cfg = (await (
    await fetch("/api/push/config", { credentials: "include" })
  ).json()) as PushConfig;
  if (!cfg.enabled || !cfg.publicKey) throw new Error("Push is not configured on the server.");

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";

  const reg = await registration();
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(cfg.publicKey),
    }));

  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(sub),
  });
  if (!res.ok) throw new Error(`subscribe failed (${res.status})`);
  return "on";
}

/** Unsubscribe locally and tell the server to drop it. */
export async function disablePush(): Promise<PushState> {
  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_SCOPE);
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push/unsubscribe", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      await sub.unsubscribe();
    }
  } catch {
    /* best effort */
  }
  return "off";
}

/** Fire a server-side test push to all subscriptions. */
export async function testPush(): Promise<void> {
  const res = await fetch("/api/push/test", { method: "POST", credentials: "include" });
  if (!res.ok) throw new Error(`test failed (${res.status})`);
}
