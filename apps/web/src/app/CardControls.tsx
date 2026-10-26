import type { Chip } from "../server/chips";
import { feedbackAction } from "./feedback/actions";

// ADR-0006 C-20: Save on the card; the other controls in its overflow menu. One form
// per card: the pressed button names the control (no client script needed).
export function CardControls({
  itemId,
  title,
  saved,
  chip,
}: {
  itemId: string;
  title: string;
  saved: boolean;
  chip: Chip;
}) {
  // Every card has these buttons: the title tells them apart for a screen reader.
  return (
    <form action={feedbackAction} aria-label={`Actions for ${title}`}>
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="chip" value={chip} />
      {saved ? (
        <button
          type="submit"
          name="control"
          value="unsave"
          aria-label={`Saved: unsave ${title}`}
        >
          Saved ✓
        </button>
      ) : (
        <button
          type="submit"
          name="control"
          value="save"
          aria-label={`Save ${title}`}
        >
          Save
        </button>
      )}
      <details>
        <summary>More options</summary>
        <button type="submit" name="control" value="more_like_this">
          More like this
        </button>
        <button type="submit" name="control" value="less_like_this">
          Less like this
        </button>
        <button type="submit" name="control" value="not_interested">
          Not interested
        </button>
        <button type="submit" name="control" value="hide_source">
          Hide this source
        </button>
      </details>
    </form>
  );
}

// Straight after Not interested only (owner, 2026-10-26): there is no list to undo
// it from later in Phase 1.
export function UndoNotInterested({
  itemId,
  chip,
}: {
  itemId: string;
  chip: Chip;
}) {
  return (
    <form action={feedbackAction}>
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="chip" value={chip} />
      <p>
        Hidden.{" "}
        <button type="submit" name="control" value="undo_not_interested">
          Undo
        </button>
      </p>
    </form>
  );
}
