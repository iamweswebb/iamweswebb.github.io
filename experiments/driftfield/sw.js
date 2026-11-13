// Driftfield offline cache.
// Pages (and this app's manifest) come from the network first, so a push shows up on the next open;
// the saved copy is only used when offline. Icons and fonts are served from the cache and refreshed in the background.
const CACHE = "driftfield-v13";
const CORE = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];
self.addEventListener("install", (e) => {
  // "reload" skips the browser's own HTTP cache so a fresh install never saves an old page
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE.map((u) => new Request(u, { cache: "reload" })))));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url), ours = url.origin === self.location.origin, fonts = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (!ours && !fonts) return;
  const page = req.mode === "navigate" || (ours && /(\/|\.html|\.webmanifest)$/.test(url.pathname));
  if (page) {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      try {
        const res = await fetch(new Request(url.href, { cache: "no-cache", credentials: "same-origin" }));
        if (res && res.ok) c.put(req, res.clone());
        return res;
      } catch (err) {
        return (await c.match(req, { ignoreSearch: true })) || (await c.match("./index.html")) || Response.error();
      }
    }));
    return;
  }
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(req, { ignoreSearch: ours });
    const net = fetch(req).then((res) => { if (res && (res.ok || res.type === "opaque")) c.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
});
