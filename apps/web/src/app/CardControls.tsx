import type { Chip } from "../server/chips";
import { feedbackAction } from "./feedback/actions";

// Round icon buttons beside the card's pill (design screen 2).
const ROUND =
  "flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full border border-hairline bg-page text-ink";
const MENU_ITEM =
  "w-full rounded-xl px-3 py-2 text-left hover:bg-well focus-visible:bg-well";

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
  // Every card has these buttons: the title tells them apart for a screen reader. The
  // Save button is only an icon, so its label is its whole name.
  return (
    <form
      action={feedbackAction}
      aria-label={`Actions for ${title}`}
      className="flex shrink-0 items-center gap-2"
    >
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="chip" value={chip} />
      <button
        type="submit"
        name="control"
        value={saved ? "unsave" : "save"}
        aria-label={saved ? `Saved: unsave ${title}` : `Save ${title}`}
        className={ROUND}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-5"
          fill={saved ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        >
          <path d="M6 3h12v18l-6-4-6 4z" />
        </svg>
      </button>
      <details className="relative">
        <summary
          className={`${ROUND} list-none [&::-webkit-details-marker]:hidden`}
        >
          <span aria-hidden="true">…</span>
          <span className="sr-only">More options</span>
        </summary>
        {/* To the left of the button, rising from its foot: inside the card, where the
          sideways feed row can't clip it (ADR-0019). */}
        <div className="absolute right-full bottom-0 z-20 mr-2 flex w-52 flex-col rounded-2xl border border-hairline bg-page p-1 shadow-card">
          <button
            type="submit"
            name="control"
            value="more_like_this"
            className={MENU_ITEM}
          >
            More like this
          </button>
          <button
            type="submit"
            name="control"
            value="less_like_this"
            className={MENU_ITEM}
          >
            Less like this
          </button>
          <button
            type="submit"
            name="control"
            value="not_interested"
            className={MENU_ITEM}
          >
            Not interested
          </button>
          <button
            type="submit"
            name="control"
            value="hide_source"
            className={MENU_ITEM}
          >
            Hide this source
          </button>
        </div>
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
    <form action={feedbackAction} className="my-4">
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="chip" value={chip} />
      <p className="flex items-center justify-between rounded-2xl bg-well px-4 py-3">
        Hidden.{" "}
        <button
          type="submit"
          name="control"
          value="undo_not_interested"
          className="font-semibold text-select"
        >
          Undo
        </button>
      </p>
    </form>
  );
}
