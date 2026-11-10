"use client";

import type { ListenExplainer } from "@interval/api-client";
import { Button } from "../ui/Button";
import { clock, usePlayer } from "./MiniPlayer";
import { player } from "./player";

// P4-W23-S01 (§5I): Library's audio queue. The page's own read first, then the player's
// as it changes (a removal, an explainer finished).
export function AudioQueue({ initial }: { initial: ListenExplainer[] }) {
  const state = usePlayer();
  const queue = state.status === "ready" ? state.queue : initial;
  if (queue.length === 0) {
    return (
      <p className="px-5 py-4 text-ink-muted">
        Nothing queued. Listen in the reader adds a section’s AI explainers
        here.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-hairline">
      {queue.map((q) => (
        <li key={q.explainerId} className="flex items-center gap-3 px-5 py-3">
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{q.concept}</span>
            <span className="block text-sm text-ink-muted">
              AI explainer · {clock(q.durationSeconds)}
              {q.positionSeconds > 0 ? ` · at ${clock(q.positionSeconds)}` : ""}
            </span>
          </span>
          <Button
            type="button"
            className="px-4 py-1.5 text-sm"
            aria-label={`Play ${q.concept}`}
            onClick={() => {
              void (async () => {
                if (player().snapshot().status !== "ready")
                  await player().load();
                await player().play(q.explainerId);
              })().catch((error: unknown) => {
                console.error(error);
              });
            }}
          >
            Play
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="px-4 py-1.5 text-sm"
            aria-label={`Remove ${q.concept}`}
            onClick={() => void player().remove(q.explainerId)}
          >
            Remove
          </Button>
        </li>
      ))}
    </ul>
  );
}
