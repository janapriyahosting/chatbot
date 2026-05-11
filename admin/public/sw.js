// Janapriya Chatbot agent PWA service worker.
//
// Day-1 responsibilities:
//   - install/activate fast so installed apps swap to new versions cleanly
//   - leave hashed bundle requests alone (vite bundles are content-addressed;
//     the browser HTTP cache + the SPA's no-store index.html handle freshness)
//   - serve a cached app shell when navigation requests fail (no offline UI
//     for now beyond "the page loads"; full offline is out of scope)
//   - stub push + notificationclick handlers so Day-2 push fan-out has a
//     landing pad without another sw.js deploy
//
// Day-2 will fill in the push handler with the real payload format.

const SHELL_CACHE = "cb-shell-v1";
const SHELL_URL = "/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.add(SHELL_URL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Same-origin only. Cross-origin requests (fonts, etc.) are pass-through.
  if (url.origin !== self.location.origin) return;

  // Navigation requests: try network, fall back to the cached shell so the app
  // still opens when offline. The cached shell is /, which always returns the
  // current index.html (Cache-Control: no-store on the server side), so users
  // can't get stuck on a stale shell.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(SHELL_CACHE).then((cache) => cache.put(SHELL_URL, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(SHELL_URL).then((r) => r || Response.error()))
    );
    return;
  }

  // Everything else (hashed bundles, API calls, etc.) — let the browser handle
  // it directly. The HTTP cache is already correct for hashed assets, and we
  // want API calls to never be cached.
});

// --- Push notifications (Day-2 implements the real payload format) ---

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = data.title || "New chat";
  const body = data.body || "A visitor is waiting for you.";
  const convId = data.conversation_id || null;
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: convId ? "chat-" + convId : undefined,
      data: { conversation_id: convId },
      requireInteraction: false,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const convId = event.notification.data && event.notification.data.conversation_id;
  const url = convId ? `/inbox?conv=${convId}` : "/inbox";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Focus an existing app window if there is one, navigating it to the conv.
      for (const c of clients) {
        if ("focus" in c) {
          c.navigate(url).catch(() => {});
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
