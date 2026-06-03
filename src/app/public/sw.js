/* Coach PWA service worker — Web Push only (no offline caching yet).
 *
 * Shows a notification for each push and focuses/opens the app when tapped.
 * Hydration nudges carry quick-log action buttons (100/200/500 ml) that POST
 * straight to /api/hydration from the background — no need to open the app.
 * Lives at /app/sw.js so its scope covers the installed PWA (/app/). */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Claude Coach";
  const options = {
    body: data.body || "",
    icon: "/app/icon-192.png",
    badge: "/app/icon.svg",
    tag: data.tag || undefined, // collapse same-tag notifications
    // Action buttons (e.g. quick-log water). Platforms cap these at
    // navigator.maxActions (~2 on Android/desktop) and iOS ignores them
    // entirely, so the notification stays useful with none shown.
    actions: Array.isArray(data.actions) ? data.actions : undefined,
    data: { url: data.url || "/app/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Focus an open /app window, or open a fresh one at `url`.
function openApp(url) {
  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    for (const client of clients) {
      if (client.url.includes("/app") && "focus" in client) return client.focus();
    }
    return self.clients.openWindow(url);
  });
}

// Log water in the background. On failure (e.g. the Cloudflare Access session
// expired, so the POST is bounced to a login redirect) hand off to the app with
// a ?water= param so it logs once the user is re-authenticated.
async function logWater(ml) {
  try {
    const res = await fetch("/api/hydration", {
      method: "POST",
      credentials: "include",
      redirect: "manual", // an Access login redirect must count as a failure, not a silent 200
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ml }),
    });
    if (!res.ok || res.type === "opaqueredirect") throw new Error(`status ${res.status}`);
    await self.registration.showNotification("Claude Coach", {
      body: `Logged ${ml} ml 💧`,
      icon: "/app/icon.svg",
      badge: "/app/icon.svg",
      tag: "hydration-ack", // collapse repeated confirmations
    });
  } catch {
    await openApp(`/app/?water=${ml}`);
  }
}

self.addEventListener("notificationclick", (event) => {
  const action = event.action || "";
  event.notification.close();
  if (action.startsWith("log-water-")) {
    const ml = parseInt(action.slice("log-water-".length), 10);
    if (Number.isFinite(ml) && ml > 0) {
      event.waitUntil(logWater(ml));
      return;
    }
  }
  const url = (event.notification.data && event.notification.data.url) || "/app/";
  event.waitUntil(openApp(url));
});
