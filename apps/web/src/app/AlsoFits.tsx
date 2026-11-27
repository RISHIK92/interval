import type { Chip } from "../server/chips";
import type { Streak } from "../server/ports";
import { AlsoFitsListen } from "./AlsoFitsListen";
import { startDailyAction, startReviewAction } from "./quiz/actions";
import { reviewMinutes } from "./reviewTime";
import { streakText } from "./streakText";

// ADR-0044 (owner, 2026-11-23): desktop Home's "Also fits in N minutes", under the
// sideways feed: up to three fixed kinds, in the design's order, never feed cards.
// Only at `lg` and up; with nothing that qualifies there's no heading and no grid.
export type AlsoFitsCards = {
  daily: { streak: Streak } | null;
  review: { count: number } | null; // already sized to the break
  explainer: {
    explainerId: string;
    concept: string;
    durationSeconds: number;
  } | null;
};

const TILE =
  "flex h-full flex-col gap-1 rounded-2xl border border-hairline bg-card p-4 text-left shadow-card";
const KIND = "text-[13px] font-semibold text-ink-muted";
const TITLE = "text-[17px] leading-snug font-semibold";

export const breakMinutes = (chip: Chip): number => Number(chip.split("-")[1]);

export function AlsoFits({
  chip,
  cards,
}: {
  chip: Chip;
  cards: AlsoFitsCards;
}) {
  const { daily, review, explainer } = cards;
  const kept = daily === null ? null : streakText(daily.streak);
  const tiles = [
    daily === null
      ? null
      : (position: number) => (
          <form action={startDailyAction} className={TILE}>
            <input type="hidden" name="chip" value={chip} />
            <input type="hidden" name="alsoFits" value={position} />
            <p className={KIND}>Daily challenge</p>
            <p className={TITLE}>Today&apos;s 5 questions · 2 minutes</p>
            <p className="text-sm text-ink-muted">
              {kept === null ? "One attempt today." : `Keeps your ${kept}.`}
            </p>
            <button
              type="submit"
              className="mt-auto cursor-pointer self-start rounded-full bg-live px-5 py-2 font-semibold text-page"
            >
              Play
            </button>
          </form>
        ),
    review === null
      ? null
      : (position: number) => (
          <form action={startReviewAction} className="h-full">
            <input type="hidden" name="chip" value={chip} />
            <input type="hidden" name="limit" value={review.count} />
            <input type="hidden" name="alsoFits" value={position} />
            <button type="submit" className={`${TILE} w-full cursor-pointer`}>
              <span className={KIND}>Spaced review</span>
              <span className={TITLE}>
                Review{" "}
                {review.count === 1
                  ? "1 card"
                  : `${String(review.count)} cards`}
              </span>
              <span className="text-sm text-ink-muted">
                About {reviewMinutes(review.count)}{" "}
                {reviewMinutes(review.count) === 1 ? "minute" : "minutes"}
              </span>
            </button>
          </form>
        ),
    explainer === null
      ? null
      : (position: number) => (
          <AlsoFitsListen
            explainerId={explainer.explainerId}
            position={position}
            chip={chip}
            className={`${TILE} w-full cursor-pointer`}
          >
            <span className={KIND}>AI explainer</span>
            <span className={TITLE}>{explainer.concept}, explained</span>
            <span className="text-sm text-ink-muted">
              Listen, {Math.max(1, Math.round(explainer.durationSeconds / 60))}{" "}
              min
            </span>
          </AlsoFitsListen>
        ),
  ].filter((tile) => tile !== null);
  if (tiles.length === 0) return null;
  return (
    <section aria-labelledby="also-fits" className="mt-6 hidden lg:block">
      <h2 id="also-fits" className="text-[17px] font-semibold">
        Also fits in {breakMinutes(chip)} minutes
      </h2>
      <ul className="mt-3 grid grid-cols-3 gap-3">
        {tiles.map((tile, index) => (
          <li key={index}>{tile(index + 1)}</li>
        ))}
      </ul>
    </section>
  );
}
