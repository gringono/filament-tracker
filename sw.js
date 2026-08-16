const CACHE = "filament-v4.9";
const ASSETS = ["./index.html", "./manifest.json"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});
self.addEventListener("fetch", e => {
  const url = e.request.url;
  if (url.includes("api.anthropic.com") || url.includes("fonts.googleapis.com")) return;

  // HTML/Navigation: network-first — lädt immer die neueste Version, Cache nur als Offline-Fallback.
  const isDoc = e.request.mode === "navigate" || url.endsWith("index.html") || url.endsWith("/");
  if (isDoc) {
    e.respondWith(
      fetch(e.request)
        .then(r => {
          const copy = r.clone();
          caches.open(CACHE).then(c => c.put("./index.html", copy));
          return r;
        })
        .catch(() => caches.match("./index.html").then(r => r || caches.match(e.request)))
    );
    return;
  }

  // Übrige Assets: cache-first (schnell, offline-tauglich).
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
