"use client";

import { type ReactNode, useEffect, useReducer } from "react";
import type { Chip } from "../server/chips";
import { finishAction } from "./finish/actions";
import { initialPrompt, promptState } from "./promptState";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

// The return prompt (§5D, Q-P1-32): back on this tab after opening a card, ask once.
// Card links mark themselves with data-item (and data-moment for a section).
// `children` (the Now reading panel) shows whenever the prompt doesn't.
export function ReturnPrompt({
  chip,
  children,
}: {
  chip: Chip;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(promptState, initialPrompt);
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const link =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>("a[data-item]")
          : null;
      const itemId = link?.dataset["item"];
      if (itemId === undefined) return;
      dispatch({
        type: "opened",
        open: { itemId, momentId: link?.dataset["moment"] ?? null },
      });
    };
    const onVisibility = () => {
      dispatch({ type: document.hidden ? "hidden" : "visible" });
    };
    document.addEventListener("click", onClick);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  const asked = state.prompt;
  if (asked === null) return children;
  return (
    <form
      action={finishAction}
      role="alertdialog"
      aria-label="Finished reading?"
      className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 mx-auto max-w-xl px-4"
      onSubmit={() => {
        // Closed even when the redirect lands on the same URL and nothing remounts.
        dispatch({ type: "closed" });
      }}
    >
      <input type="hidden" name="control" value="finish" />
      <input type="hidden" name="itemId" value={asked.itemId} />
      {asked.momentId === null ? null : (
        <input type="hidden" name="momentId" value={asked.momentId} />
      )}
      <input type="hidden" name="method" value="return_prompt" />
      <input type="hidden" name="chip" value={chip} />
      {/* A bottom sheet just above the tab bar (design screen 2). */}
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-well text-go-text"
          >
            <svg
              viewBox="0 0 24 24"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12l5 5 9-10" />
            </svg>
          </span>
          <p className="text-section">
            {asked.momentId === null
              ? "Finished this article?"
              : "Finished this section? Continue to the next?"}
          </p>
        </div>
        <div className="mt-4 flex gap-2">
          {/* Focus moves here so a screen reader announces the question. */}
          <Button type="submit" autoFocus className="flex-1">
            Yes
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="flex-1"
            onClick={() => {
              dispatch({ type: "closed" });
            }}
          >
            No
          </Button>
        </div>
      </Card>
    </form>
  );
}
