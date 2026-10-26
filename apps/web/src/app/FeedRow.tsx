"use client";

import { type ReactNode, useEffect, useRef } from "react";

// One swipe or wheel flick sends a stream of events (a trackpad keeps going with
// momentum); it counts as one gesture until it pauses this long.
const SETTLE_MS = 400;

type Wheel = {
  timeStamp: number;
  deltaX: number;
  deltaY: number;
  ctrlKey: boolean;
  scrollLeft: number;
  maxScroll: number;
};

export type WheelDecision =
  | { action: "move"; step: -1 | 1; settledUntil: number }
  | { action: "swallow"; settledUntil: number }
  | { action: "pass" };

// What one wheel event does to the feed row (owner, 2026-10-26: one swipe, one card).
// A vertical gesture moves one card and swallows the rest of itself; at either end, or
// sideways (native snap has it), or for pinch-zoom, the browser keeps it.
export function wheelDecision(
  settledUntil: number,
  wheel: Wheel,
): WheelDecision {
  const { timeStamp, deltaX, deltaY, ctrlKey, scrollLeft, maxScroll } = wheel;
  if (ctrlKey || deltaY === 0 || Math.abs(deltaX) >= Math.abs(deltaY))
    return { action: "pass" };
  if (timeStamp < settledUntil)
    return { action: "swallow", settledUntil: timeStamp + SETTLE_MS };
  const step = deltaY > 0 ? 1 : -1;
  const room = step === 1 ? scrollLeft < maxScroll - 1 : scrollLeft > 1;
  return room
    ? { action: "move", step, settledUntil: timeStamp + SETTLE_MS }
    : { action: "pass" };
}

// ADR-0019's sideways feed. Touch and sideways trackpad swipes snap natively, one
// card at a time (snap-always on each card); a vertical wheel or swipe over the row is
// turned into one card here, then the page at either end.
export function FeedRow({ children }: { children: ReactNode }) {
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = row.current;
    if (element === null) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    let settledUntil = 0;
    const onWheel = (event: WheelEvent) => {
      const decision = wheelDecision(settledUntil, {
        timeStamp: event.timeStamp,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        ctrlKey: event.ctrlKey,
        scrollLeft: element.scrollLeft,
        maxScroll: element.scrollWidth - element.clientWidth,
      });
      if (decision.action === "pass") return;
      event.preventDefault();
      settledUntil = decision.settledUntil;
      if (decision.action === "swallow") return;
      // To the neighbouring card's edge, so the step lands on exactly one card.
      const cards = Array.from(element.querySelectorAll("li"));
      const at = cards.findIndex(
        (card) => card.offsetLeft >= element.scrollLeft - 1,
      );
      const target = cards[Math.max(0, at) + decision.step];
      if (target === undefined) return;
      element.scrollTo({
        left: target.offsetLeft - (cards[0]?.offsetLeft ?? 0),
        behavior: still.matches ? "auto" : "smooth",
      });
    };
    // Not passive: a move must stop the page from scrolling too.
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      element.removeEventListener("wheel", onWheel);
    };
  }, []);
  return (
    <div
      ref={row}
      role="region"
      aria-label="Your feed"
      tabIndex={0}
      // The vertical padding, taken back by the negative margin, keeps card shadows
      // from being clipped by the scroller.
      className="-my-3 mt-3 snap-x snap-mandatory overflow-x-auto overscroll-x-contain py-3 [scrollbar-width:none] focus-visible:outline-2 focus-visible:outline-select [&::-webkit-scrollbar]:hidden"
    >
      {children}
    </div>
  );
}
