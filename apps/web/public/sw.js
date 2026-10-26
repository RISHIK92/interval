// Only the offline page is cached (Q-P1-31, owner 2026-10-26): every other request
// goes to the network as usual, so no signed-in page is ever stored.
// Bump when the offline page changes: installed browsers keep the cached copy.
const CACHE = "interval-offline-v2";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add("/offline")));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.mode !== "navigate") return;
  event.respondWith(
    fetch(request).catch(() =>
      caches.match("/offline").then((page) => page ?? Response.error()),
    ),
  );
});
