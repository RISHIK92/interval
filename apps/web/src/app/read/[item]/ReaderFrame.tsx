"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

const STALL_MS = 6000;
// The publisher's scripts run in their own origin; no access to Interval's, and no
// top-level navigation (frame-busting stays blocked).
export const FRAME_SANDBOX =
  "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms";
export const FRAME_REFERRER = "strict-origin-when-cross-origin";
const noChanges = () => () => undefined;

// ADR-0018: the publisher's live page, framed. A frame can't report a refusal or a
// blank page across origins, so a load that hasn't come after 6 s offers the browser,
// in a bar below the frame.
export function ReaderFrame({
  src,
  title,
  domain,
  browserHref,
}: {
  src: string;
  title: string;
  domain: string;
  browserHref: string;
}) {
  // The frame mounts after hydration, so its load event can't fire before React
  // listens (a fast page would otherwise get the stall card over it), and the 6 s
  // count from when the frame really starts loading.
  const mounted = useSyncExternalStore(
    noChanges,
    () => true,
    () => false,
  );
  const [phase, setPhase] = useState<"loading" | "stalled" | "done">("loading");
  useEffect(() => {
    const timer = setTimeout(() => {
      setPhase((now) => (now === "loading" ? "stalled" : now));
    }, STALL_MS);
    return () => {
      clearTimeout(timer);
    };
  }, []);
  return (
    <>
      <div
        className="relative min-h-0 flex-1 bg-well"
        data-frame-src={src}
        data-frame-title={title}
      >
        {mounted ? (
          <iframe
            src={src}
            title={title}
            sandbox={FRAME_SANDBOX}
            referrerPolicy={FRAME_REFERRER}
            className="absolute inset-0 size-full border-0 bg-page"
            onLoad={() => {
              setPhase("done");
            }}
          />
        ) : null}
      </div>
      {/* A live region present from the start, so a screen reader announces the bar
        when it fills. */}
      <div role="status" className="shrink-0">
        {phase === "stalled" ? (
          <SlowBar
            domain={domain}
            browserHref={browserHref}
            onClose={() => {
              setPhase("done");
            }}
          />
        ) : null}
      </div>
    </>
  );
}

// Below the frame, never over it (owner, 2026-10-26): heavy pages often look ready
// long before their load event.
export function SlowBar({
  domain,
  browserHref,
  onClose,
}: {
  domain: string;
  browserHref: string;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center gap-3 border-t border-hairline bg-well px-4 py-2 text-sm">
      <p className="min-w-0 flex-1 truncate text-ink-muted">
        Slow to load?{" "}
        <a
          href={browserHref}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-select"
        >
          {`Open on ${domain}`}
        </a>
      </p>
      <button
        type="button"
        aria-label="Dismiss slow-load notice"
        onClick={onClose}
        className="flex size-7 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-page"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
