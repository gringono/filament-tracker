const CACHE = "filament-v3";
const ASSETS = ["./index.html", "./manifest.json"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting(); // activate immediately
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim(); // take control immediately
});

self.addEventListener("fetch", e => {
  // Never cache API calls
  if (e.request.url.includes("api.anthropic.com") ||
      e.request.url.includes("googleapis.com") ||
      e.request.url.includes("fonts.googleapis.com") ||
      e.request.url.includes("cdnjs.cloudflare.com")) return;

  // Network first for HTML — always get fresh version
  if (e.request.url.endsWith(".html") || e.request.url.endsWith("/")) {
    e.respondWith(
      fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // Cache first for everything else
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
