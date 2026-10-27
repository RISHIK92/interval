import { noteAction } from "./notes/actions";
import { Button } from "./ui/Button";

// A private note on what's being read (§5I, Q-P2-01): on the section, or on the
// article when momentId is null. A small icon at its container's top right (the
// container is `relative`; owner, 2026-10-27) that opens the text area below; filled
// when a note exists. A disclosure, so it works without script.
export function NoteBox({
  itemId,
  momentId,
  note,
  back,
}: {
  itemId: string;
  momentId: string | null;
  note: string | null;
  back: string;
}) {
  return (
    <details className="group">
      <summary
        title={note === null ? "Add a note" : "Your note"}
        className="absolute top-3 right-3 flex size-9 cursor-pointer list-none items-center justify-center rounded-full border border-hairline bg-page text-ink group-open:bg-well [&::-webkit-details-marker]:hidden"
      >
        <span className="sr-only">
          {note === null ? "Add a note" : "Your note"}
        </span>
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 4h10l4 4v12H5zM9 12h6M9 16h4" />
        </svg>
        {note === null ? null : (
          <span
            aria-hidden="true"
            className="absolute top-1 right-1 size-2 rounded-full bg-ink"
          />
        )}
      </summary>
      <form action={noteAction} className="mt-3 flex flex-col gap-2">
        <input type="hidden" name="itemId" value={itemId} />
        {momentId === null ? null : (
          <input type="hidden" name="momentId" value={momentId} />
        )}
        <input type="hidden" name="back" value={back} />
        <textarea
          name="body"
          aria-label={
            momentId === null ? "Note on this article" : "Note on this section"
          }
          maxLength={2000}
          rows={3}
          defaultValue={note ?? ""}
          className="w-full rounded-2xl border border-hairline bg-page px-4 py-3 text-base text-ink"
        />
        <div className="flex gap-2">
          <Button type="submit" name="control" value="save">
            Save note
          </Button>
          {note === null ? null : (
            <Button
              type="submit"
              name="control"
              value="delete"
              variant="secondary"
            >
              Delete note
            </Button>
          )}
        </div>
      </form>
    </details>
  );
}
