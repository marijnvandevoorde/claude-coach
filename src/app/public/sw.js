/* Coach PWA service worker — Web Push only (no offline caching yet).
 *
 * Shows a notification for each push and focuses/opens the app when tapped.
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
    icon: "/app/icon.svg",
    badge: "/app/icon.svg",
    tag: data.tag || undefined, // collapse same-tag notifications
    data: { url: data.url || "/app/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/app/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes("/app") && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
