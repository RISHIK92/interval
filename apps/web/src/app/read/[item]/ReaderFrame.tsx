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
// blank page across origins, so a load that hasn't come after 6 s offers the browser.
// Nothing covers a loaded page.
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
      {phase === "stalled" ? (
        <div
          role="status"
          className="absolute inset-x-4 top-1/3 mx-auto max-w-sm rounded-3xl border border-hairline bg-page p-5 text-center shadow-card"
        >
          <p className="text-section">This page is taking a while.</p>
          <div className="mt-4 flex flex-col gap-2">
            <a
              href={browserHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center rounded-full bg-ink px-5 py-2.5 font-semibold text-page"
            >
              {`Open on ${domain}`}
            </a>
            <button
              type="button"
              onClick={() => {
                setPhase("done");
              }}
              className="text-sm text-ink-muted underline-offset-2 hover:underline"
            >
              Keep waiting
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
