"use client";

import { useState } from "react";

// The DOM types say every browser can share; desktop ones mostly can't.
type Sharing = {
  share?: (data: { url: string }) => Promise<void>;
  clipboard: { writeText: (text: string) => Promise<void> };
};

// P3-W13-S06 (owner, 2026-11-01): the share sheet where the browser has one, else the
// link is copied. What to say afterwards, if anything: a closed sheet says nothing.
export async function shareLink(
  url: string,
  sharing: Sharing,
): Promise<string | null> {
  if (sharing.share !== undefined) {
    try {
      await sharing.share({ url });
      return null;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError")
        return null;
      // A sheet that can't open (no target, not allowed): copy instead.
    }
  }
  try {
    await sharing.clipboard.writeText(url);
    return "Link copied";
  } catch {
    return "Couldn't share";
  }
}

export function ShareButton({ shareId }: { shareId: string }) {
  const [said, setSaid] = useState<string | null>(null);
  return (
    <div data-share={shareId} className="flex flex-col items-center gap-1">
      <button
        type="button"
        className="cursor-pointer rounded-full border border-hairline px-5 py-2.5 font-semibold"
        onClick={() => {
          void shareLink(`${location.origin}/daily/${shareId}`, navigator).then(
            setSaid,
          );
        }}
      >
        Share your result
      </button>
      <p role="status" className="text-sm text-ink-muted">
        {said}
      </p>
    </div>
  );
}
