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

// P3-W17-S05b (§7, Q-P3-18): the agent hook's nudge, 45 seconds into a task. The
// worker's payload is fixed text (interval_jobs/agent_push.py), never the task's.
self.addEventListener("push", (event) => {
  let note;
  try {
    note = event.data ? event.data.json() : {};
  } catch {
    // Unreadable: the fixed text below still shows.
    note = {};
  }
  event.waitUntil(
    self.registration.showNotification(
      note.title || "Your agent is still working",
      {
        body: note.body || "Open Interval for a quick session",
        icon: "/icons/icon-192.png",
        tag: "agent-nudge",
        data: { url: "/" },
      },
    ),
  );
});

// Back to Interval: an open window if there is one, else a new one; never another
// site.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windows) => {
        const open = windows.find((w) => "focus" in w);
        return open ? open.focus() : self.clients.openWindow("/");
      }),
  );
});

// The browser replaced this device's subscription: subscribe again with the same
// options, and tell Interval (the same request the Profile button makes).
self.addEventListener("pushsubscriptionchange", (event) => {
  const options = event.oldSubscription && event.oldSubscription.options;
  if (!options) return;
  event.waitUntil(
    self.registration.pushManager.subscribe(options).then((subscription) =>
      fetch("/api/push/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      }),
    ),
  );
});
