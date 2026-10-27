import type { Chip } from "../server/chips";
import type { Reading } from "../server/reading";
import { finishAction } from "./finish/actions";
import { NoteBox } from "./NoteBox";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

// The context panel (C-22): what was opened last, with Mark done for when the return
// prompt was dismissed (Q-P1-35), and Dismiss.
export function NowReading({
  reading,
  titles,
  chip,
  note,
}: {
  reading: Reading;
  titles: { articleTitle: string; sectionTitle: string | null };
  chip: Chip;
  note: string | null;
}) {
  const name =
    titles.sectionTitle === null || titles.sectionTitle === titles.articleTitle
      ? titles.articleTitle
      : `${titles.sectionTitle} — ${titles.articleTitle}`;
  return (
    <Card className="relative my-4 p-4">
      <form action={finishAction} aria-label="Now reading">
        <input type="hidden" name="itemId" value={reading.itemId} />
        {reading.momentId === null ? null : (
          <input type="hidden" name="momentId" value={reading.momentId} />
        )}
        <input type="hidden" name="method" value="mark_done" />
        <input type="hidden" name="chip" value={chip} />
        <p className="text-sm text-ink-muted">Now reading</p>
        {/* Clear of the note icon at the top right. */}
        <p className="pr-12 font-semibold">{name}</p>
        <div className="mt-3 flex gap-2">
          <Button type="submit" name="control" value="finish">
            {reading.momentId === null
              ? "Mark article done"
              : "Mark section done"}
          </Button>
          <Button
            type="submit"
            name="control"
            value="dismiss"
            variant="secondary"
          >
            Dismiss
          </Button>
        </div>
      </form>
      {/* Its own form: a note isn't part of finishing (Q-P2-01). */}
      <NoteBox
        itemId={reading.itemId}
        momentId={reading.momentId}
        note={note}
        back={`/?chip=${chip}`}
      />
    </Card>
  );
}
