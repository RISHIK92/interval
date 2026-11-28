import { finishAction } from "./finish/actions";
import { NoteBox } from "./NoteBox";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

// The context panel (C-22): the article opened last, with Mark done for when the
// return prompt was dismissed (Q-P1-35), and Dismiss. ADR-0058: always a whole article.
export function NowReading({
  itemId,
  articleTitle,
  note,
}: {
  itemId: string;
  articleTitle: string;
  note: string | null;
}) {
  return (
    <Card className="relative my-4 p-4">
      <form action={finishAction} aria-label="Now reading">
        <input type="hidden" name="itemId" value={itemId} />
        <input type="hidden" name="method" value="mark_done" />
        <p className="text-sm text-ink-muted">Now reading</p>
        {/* Clear of the note icon at the top right. */}
        <p className="pr-12 font-semibold">{articleTitle}</p>
        <div className="mt-3 flex gap-2">
          <Button type="submit" name="control" value="finish">
            Mark article done
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
      <NoteBox on={{ itemId }} about={articleTitle} note={note} back="/" />
    </Card>
  );
}
