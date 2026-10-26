import type { Chip } from "../server/chips";
import type { Reading } from "../server/reading";
import { finishAction } from "./finish/actions";

// The context panel (C-22): what was opened last, with Mark done for when the return
// prompt was dismissed (Q-P1-35), and Dismiss.
export function NowReading({
  reading,
  titles,
  chip,
}: {
  reading: Reading;
  titles: { articleTitle: string; sectionTitle: string | null };
  chip: Chip;
}) {
  const name =
    titles.sectionTitle === null
      ? titles.articleTitle
      : `${titles.sectionTitle} — ${titles.articleTitle}`;
  return (
    <form action={finishAction} aria-label="Now reading">
      <input type="hidden" name="itemId" value={reading.itemId} />
      {reading.momentId === null ? null : (
        <input type="hidden" name="momentId" value={reading.momentId} />
      )}
      <input type="hidden" name="method" value="mark_done" />
      <input type="hidden" name="chip" value={chip} />
      <p>{`Now reading: ${name}`}</p>
      <button type="submit" name="control" value="finish">
        {reading.momentId === null ? "Mark article done" : "Mark section done"}
      </button>{" "}
      <button type="submit" name="control" value="dismiss">
        Dismiss
      </button>
    </form>
  );
}
