"use client";

import { useEffect, useState } from "react";

type State = "checking" | "unsupported" | "off" | "on" | "denied" | "failed";

// The VAPID public key (base64url) as the bytes PushManager.subscribe wants.
function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  const raw = atob(key.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

const READY_MS = 10_000;

async function save(subscription: PushSubscription): Promise<void> {
  const saved = await fetch("/api/push/subscription", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription.toJSON()),
  });
  if (!saved.ok) throw new Error(`push: ${String(saved.status)}`);
}

const supported = () =>
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

// P3-W17-S05b (§7, Q-P3-18; owner, 2026-11-03): this browser gets the agent hook's
// notification 45 s into a task. The browser asks permission only on the click.
export function NotifyHere({ pushKey }: { pushKey: string }) {
  const [state, setState] = useState<State>("checking");
  useEffect(() => {
    if (!supported()) {
      queueMicrotask(() => {
        setState("unsupported");
      });
      return;
    }
    // A worker that never registered never readies: give up after a while.
    const ready = Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) =>
        setTimeout(() => {
          reject(new Error("no service worker"));
        }, READY_MS),
      ),
    ]);
    ready
      .then((registration) => registration.pushManager.getSubscription())
      .then(async (subscription) => {
        if (Notification.permission === "denied") {
          setState("denied");
          return;
        }
        if (subscription === null) {
          setState("off");
          return;
        }
        // Sent again on each visit: the server may have lost it (a failed save), or
        // another account signed in on this browser since; saving moves it here.
        await save(subscription);
        setState("on");
      })
      .catch((error: unknown) => {
        console.error("push: state unknown", error);
        setState("failed");
      });
  }, []);

  const turnOn = async () => {
    if ((await Notification.requestPermission()) !== "granted") {
      setState("denied");
      return;
    }
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(pushKey),
    });
    await save(subscription);
    setState("on");
  };

  const turnOff = async () => {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription !== null) {
      const removed = await fetch("/api/push/subscription", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      // Unsubscribed below anyway; the server's row then goes at the next push (410).
      if (!removed.ok)
        console.error("push: not removed on the server", removed.status);
      await subscription.unsubscribe();
    }
    setState("off");
  };

  const act = (step: () => Promise<void>) => () => {
    step().catch((error: unknown) => {
      console.error("push: change failed", error);
      setState("failed");
    });
  };

  if (state === "unsupported") return null;
  return (
    <div className="flex flex-wrap items-center gap-3">
      {state === "on" ? (
        <>
          <span role="status" className="text-sm">
            This device is notified 45 s into a task.
          </span>
          <button
            type="button"
            onClick={act(turnOff)}
            className="cursor-pointer rounded-full border border-hairline px-4 py-1.5 text-sm font-semibold"
          >
            Turn off
          </button>
        </>
      ) : (
        <button
          type="button"
          disabled={state === "checking" || state === "denied"}
          onClick={act(turnOn)}
          className="cursor-pointer rounded-full border border-hairline px-4 py-1.5 text-sm font-semibold disabled:opacity-60"
        >
          Notify me on this device
        </button>
      )}
      {state === "denied" ? (
        <span role="status" className="text-sm text-ink-muted">
          Notifications are blocked for this site in the browser&apos;s
          settings.
        </span>
      ) : state === "failed" ? (
        <span role="alert" className="text-sm">
          That didn&apos;t work. Try again in a moment.
        </span>
      ) : null}
    </div>
  );
}
