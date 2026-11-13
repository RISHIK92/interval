"use client";

import { PUSH_HOURS, type PushPreferences } from "@interval/api-client";
import { useState } from "react";
import { NotifyHere } from "./NotifyHere";

// P4-W24-S01 (Q-P4-13; owner, 2026-11-11): which pushes, each off until turned on, and
// the one hour of the day for any of them. Every change saves, with this device's time
// zone, so the hour is the user's own.
const KINDS = [
  {
    key: "dailyChallenge",
    name: "Daily challenge",
    what: "When today's challenge is still unplayed.",
  },
  {
    key: "pathReminder",
    name: "Path reminders",
    what: "After two days without a reading on your path.",
  },
  {
    key: "digest",
    name: "Your break is ready",
    what: "When your feed has something you haven't opened.",
  },
  {
    key: "battleWindow",
    name: "Battle windows",
    what: "15 minutes before a ranked window you registered for.",
  },
] as const;

const HOURS = Array.from(
  { length: PUSH_HOURS.max - PUSH_HOURS.min + 1 },
  (_, i) => PUSH_HOURS.min + i,
);

export function NotificationsCard(props: {
  initial: PushPreferences;
  pushKey: string | null;
}) {
  const [saved, setSaved] = useState(props.initial);
  // One save at a time (each sends the whole state): the controls wait, and a failure
  // goes back to what the server last confirmed.
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function change(next: PushPreferences) {
    const confirmed = saved;
    setSaved(next);
    setSaving(true);
    setStatus(null);
    const response = await fetch("/api/push/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...next,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    }).catch((error: unknown) => {
      console.error("push settings: not sent", error);
      return null;
    });
    if (response !== null && !response.ok)
      console.error("push settings: not saved", response.status);
    if (response?.ok !== true) {
      setSaved(confirmed);
      setStatus("Couldn’t save. Try again.");
    }
    setSaving(false);
  }

  return (
    <section aria-label="Notifications" className="flex flex-col gap-4">
      <h2 className="text-section">Notifications</h2>
      <p className="text-sm text-ink-muted">
        At most one a day, at the hour you pick, never between 21:00 and 08:00.
      </p>
      {KINDS.map((kind) => (
        <div key={kind.key} className="flex items-start gap-3">
          <input
            id={`push-${kind.key}`}
            type="checkbox"
            role="switch"
            className="mt-1 size-5"
            disabled={saving}
            checked={saved[kind.key] ?? false}
            aria-describedby={`push-${kind.key}-what`}
            onChange={(e) => {
              void change({ ...saved, [kind.key]: e.target.checked });
            }}
          />
          <span>
            <label htmlFor={`push-${kind.key}`} className="block font-semibold">
              {kind.name}
            </label>
            <span
              id={`push-${kind.key}-what`}
              className="block text-sm text-ink-muted"
            >
              {kind.what}
            </span>
          </span>
        </div>
      ))}
      <label className="flex items-center justify-between gap-3">
        <span className="font-semibold">Notification hour</span>
        <select
          className="rounded-lg border border-hairline bg-page px-3 py-2"
          disabled={saving}
          value={saved.hour}
          onChange={(e) => {
            void change({ ...saved, hour: Number(e.target.value) });
          }}
        >
          {HOURS.map((hour) => (
            <option key={hour} value={hour}>
              {`${String(hour).padStart(2, "0")}:00`}
            </option>
          ))}
        </select>
      </label>
      {status === null ? null : (
        <p role="alert" className="text-sm">
          {status}
        </p>
      )}
      {/* They go to the browsers and phones notifications are on for; this browser's
        subscription also carries the agent hook's nudge (P3-W17-S05b). */}
      {props.pushKey === null ? null : (
        <div className="flex flex-col gap-2 border-t border-hairline pt-4">
          <span className="text-sm text-ink-muted">This browser</span>
          <NotifyHere pushKey={props.pushKey} />
        </div>
      )}
    </section>
  );
}
