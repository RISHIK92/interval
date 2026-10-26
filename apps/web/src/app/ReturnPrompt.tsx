"use client";

import { type ReactNode, useEffect, useReducer } from "react";
import type { Chip } from "../server/chips";
import { finishAction } from "./finish/actions";
import { initialPrompt, promptState } from "./promptState";

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
      <p>
        {asked.momentId === null
          ? "Finished this article?"
          : "Finished this section? Continue to the next?"}
      </p>
      {/* Focus moves here so a screen reader announces the question. */}
      <button type="submit" autoFocus>
        Yes
      </button>{" "}
      <button
        type="button"
        onClick={() => {
          dispatch({ type: "closed" });
        }}
      >
        No
      </button>
    </form>
  );
}
