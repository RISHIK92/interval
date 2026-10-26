"use client";

import { type ReactNode, useEffect, useReducer } from "react";
import type { Chip } from "../server/chips";
import { finishAction } from "./finish/actions";
import { askingAbout, type Opened, promptState } from "./promptState";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

const READER_OPEN = "iv_reader_open";

// Session storage can be missing or refuse (private modes): the Back prompt is then
// skipped, never an error for the reader.
function rememberReaderOpen(open: Opened): void {
  try {
    sessionStorage.setItem(READER_OPEN, JSON.stringify(open));
  } catch (error) {
    // No storage: × still asks; only the Back gesture won't.
    console.warn("reader: open not remembered for Back", error);
  }
}

function takeReaderOpen(): Opened | null {
  try {
    const raw = sessionStorage.getItem(READER_OPEN);
    sessionStorage.removeItem(READER_OPEN);
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    if (
      typeof value === "object" &&
      value !== null &&
      "itemId" in value &&
      typeof value.itemId === "string" &&
      "momentId" in value &&
      (value.momentId === null || typeof value.momentId === "string")
    ) {
      return { itemId: value.itemId, momentId: value.momentId };
    }
    return null;
  } catch (error) {
    console.warn("reader: remembered open unreadable", error);
    return null;
  }
}

// The return prompt (§5D, Q-P1-32): back on this tab after opening a card, ask once.
// Card links mark themselves with data-item (and data-moment for a section).
// `children` (the Now reading panel) shows whenever the prompt doesn't. `initialAsk`:
// the in-app reader just closed (ADR-0018), so the prompt opens at once for it.
export function ReturnPrompt({
  chip,
  initialAsk,
  back,
  children,
}: {
  chip: Chip;
  initialAsk: Opened | null;
  // Where answering leads, when not the feed (the Library, owner 2026-10-26).
  back?: string;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(promptState, initialAsk, askingAbout);
  useEffect(() => {
    // An in-app open is remembered for this tab (ADR-0018). Coming back with the
    // browser's Back asks about it once; arriving any other way (×, which asks
    // through `ask=`; Mark done; a fresh visit) only forgets it.
    const back = (persisted: boolean) => {
      const remembered = takeReaderOpen();
      const navigation = performance.getEntriesByType("navigation")[0];
      const viaBack =
        persisted ||
        (navigation instanceof PerformanceNavigationTiming &&
          navigation.type === "back_forward");
      if (remembered !== null && viaBack && initialAsk === null) {
        dispatch({ type: "returned", open: remembered });
      }
    };
    back(false);
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) back(true);
    };
    window.addEventListener("pageshow", onPageShow);
    if (initialAsk !== null) {
      // Asked once: a reload or Back to this page doesn't ask again.
      const url = new URL(window.location.href);
      url.searchParams.delete("ask");
      window.history.replaceState(window.history.state, "", url);
    }
    return () => {
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [initialAsk]);
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const reader =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>("a[data-read-item]")
          : null;
      const readItem = reader?.dataset["readItem"];
      if (readItem !== undefined) {
        rememberReaderOpen({
          itemId: readItem,
          momentId: reader?.dataset["readMoment"] ?? null,
        });
        return;
      }
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
      {back === undefined ? null : (
        <input type="hidden" name="back" value={back} />
      )}
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
