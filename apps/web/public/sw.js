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

// A page on this site to open, as the URL parser reads it (it drops tabs and newlines,
// so "/\t/host" is "//host": a prefix check isn't enough); anything else opens Home.
function pageOn(url) {
  if (typeof url !== "string") return "/";
  try {
    const page = new URL(url, self.location.origin);
    return page.origin === self.location.origin
      ? page.pathname + page.search + page.hash
      : "/";
  } catch {
    return "/";
  }
}

// P3-W17-S05b (§7, Q-P3-18): the agent hook's nudge, 45 seconds into a task, from fixed
// text (interval_jobs/agent_push.py), never the task's. P4-W24-S01b: an opt-in push
// (interval_jobs/reminders.py) names its page and its kind's tag, so a new one replaces
// the last of its kind.
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
        tag:
          typeof note.tag === "string" && /^[a-z_-]{1,40}$/.test(note.tag)
            ? note.tag
            : "agent-nudge",
        data: { url: pageOn(note.url) },
      },
    ),
  );
});

// Back to Interval, at the push's page: an open window if there is one (taken there),
// else a new one; never another site.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data;
  const url = pageOn(data ? data.url : undefined);
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windows) => {
        const open = windows.find((w) => "focus" in w);
        if (!open) return self.clients.openWindow(url);
        // navigate refuses a window this worker doesn't control yet (its first load,
        // a hard reload): the page opens in a new one instead.
        return open
          .focus()
          .then((focused) =>
            "navigate" in focused ? focused.navigate(url) : focused,
          )
          .catch(() => self.clients.openWindow(url));
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
