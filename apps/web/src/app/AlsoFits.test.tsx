import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { AlsoFits, type AlsoFitsCards, breakMinutes } from "./AlsoFits";
import { reviewsFitting } from "./reviewTime";

vi.mock("./quiz/actions", () => ({
  startDailyAction: vi.fn(),
  startReviewAction: vi.fn(),
}));

// ADR-0044 (owner, 2026-11-23): desktop Home's "Also fits in N minutes".
const none: AlsoFitsCards = { daily: null, review: null, explainer: null };
const all: AlsoFitsCards = {
  daily: { streak: { days: 4, freezes: 0 } },
  review: { count: 3 },
  explainer: { explainerId: "7", concept: "Pooling", durationSeconds: 230 },
};
const html = (cards: AlsoFitsCards, chip: "1-3" | "3-8" | "8-15" = "3-8") =>
  renderToStaticMarkup(<AlsoFits chip={chip} cards={cards} />);
const text = (h: string) => h.replace(/<[^>]+>/g, "|");

test("nothing that qualifies: no heading, no grid, no empty state", () => {
  expect(html(none)).toBe("");
});

test("the three cards in the design's order, under the break's heading", () => {
  const t = text(html(all));
  expect(t).toContain("Also fits in 8 minutes");
  const daily = t.indexOf("Daily challenge");
  const review = t.indexOf("Review 3 cards");
  const explainer = t.indexOf("Pooling, explained");
  expect(daily).toBeGreaterThan(-1);
  expect(review).toBeGreaterThan(daily);
  expect(explainer).toBeGreaterThan(review);
  expect(t).toContain("About 1 minute");
  expect(t).toContain("Listen, 4 min");
  expect(t).toContain("Keeps your 4-day streak.");
  expect(text(html(all, "8-15"))).toContain("Also fits in 15 minutes");
});

test("only on wide screens: phones keep ADR-0019's feed", () => {
  expect(html(all)).toMatch(/<section[^>]*class="[^"]*\bhidden lg:block/);
});

test("each card carries its place among the cards shown, and the chip", () => {
  const h = html({ ...all, daily: null });
  // The review is now first, sized to the break.
  expect(h).toMatch(
    /name="limit" value="3"\/><input type="hidden" name="alsoFits" value="1"\/>/,
  );
  expect(h).toContain('name="chip" value="3-8"');
  expect(text(h)).not.toContain("Daily challenge");
});

test("the review holds as many cards as fit the break", () => {
  expect(breakMinutes("1-3")).toBe(3);
  expect(reviewsFitting(10, 3)).toBe(9);
  expect(reviewsFitting(4, 3)).toBe(4);
  expect(reviewsFitting(10, 8)).toBe(10);
});
