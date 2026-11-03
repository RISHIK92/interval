"use client";

import { useState, useSyncExternalStore } from "react";

// Neither changes while the page is open: nothing to subscribe to.
const still = () => () => undefined;

// The link to send, with copy and (where the device has it) share. The server renders
// the path alone; the browser adds its origin and share without a hydration mismatch.
export function ChallengeLink({ token }: { token: string }) {
  const path = `/c/${token}`;
  const origin = useSyncExternalStore(
    still,
    () => window.location.origin,
    () => "",
  );
  const href = `${origin}${path}`;
  const canShare = useSyncExternalStore(
    still,
    () => "share" in navigator,
    () => false,
  );
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-2xl bg-well px-4 py-3 font-mono text-sm break-all">
        {href}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(href).then(
              () => {
                setNote("Copied");
              },
              (error: unknown) => {
                console.error("copy failed", error);
                setNote("Couldn't copy: select the link instead");
              },
            );
          }}
          className="cursor-pointer rounded-full bg-ink px-5 py-2.5 font-semibold text-page"
        >
          Copy link
        </button>
        {canShare ? (
          <button
            type="button"
            onClick={() => {
              navigator
                .share({ url: href, title: "A live match on Interval" })
                .catch((error: unknown) => {
                  // Closing the share sheet isn't a failure.
                  if (
                    error instanceof DOMException &&
                    error.name === "AbortError"
                  )
                    return;
                  console.error("share failed", error);
                  setNote("Couldn't share: copy the link instead");
                });
            }}
            className="cursor-pointer rounded-full border border-hairline px-5 py-2.5 font-semibold"
          >
            Share
          </button>
        ) : null}
        {note === null ? null : (
          <span role="status" className="text-sm text-ink-muted">
            {note}
          </span>
        )}
      </div>
    </div>
  );
}
