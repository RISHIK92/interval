import type { Chip } from "../server/chips";
import type { Reading } from "../server/reading";
import { finishAction } from "./finish/actions";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

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
    titles.sectionTitle === null || titles.sectionTitle === titles.articleTitle
      ? titles.articleTitle
      : `${titles.sectionTitle} — ${titles.articleTitle}`;
  return (
    <Card className="my-4 p-4">
      <form action={finishAction} aria-label="Now reading">
        <input type="hidden" name="itemId" value={reading.itemId} />
        {reading.momentId === null ? null : (
          <input type="hidden" name="momentId" value={reading.momentId} />
        )}
        <input type="hidden" name="method" value="mark_done" />
        <input type="hidden" name="chip" value={chip} />
        <p className="text-sm text-ink-muted">Now reading</p>
        <p className="font-semibold">{name}</p>
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
    </Card>
  );
}
