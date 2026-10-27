import { noteAction } from "./notes/actions";
import { Button } from "./ui/Button";

// A private note (§5I, Q-P2-01) on a section or article being read, or (the Library)
// a note by its own id, which also reaches one whose section was re-segmented away. A
// small icon at its container's top right (the container is `relative`; owner,
// 2026-10-27) opens the text area below; a dot marks an existing note. A disclosure,
// so it works without script. `about` names what it's on, so a list of them reads
// apart.
type On = { itemId: string; momentId: string | null } | { noteId: string };

export function NoteBox({
  on,
  about,
  note,
  back,
}: {
  on: On;
  about: string;
  note: string | null;
  back: string;
}) {
  const action = note === null ? "Add a note" : "Your note";
  return (
    <details className="group">
      <summary
        title={action}
        className="absolute top-3 right-3 flex size-9 cursor-pointer list-none items-center justify-center rounded-full border border-hairline bg-page text-ink group-open:bg-well [&::-webkit-details-marker]:hidden"
      >
        <span className="sr-only">{`${action} on ${about}`}</span>
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
        {"noteId" in on ? (
          <input type="hidden" name="noteId" value={on.noteId} />
        ) : (
          <>
            <input type="hidden" name="itemId" value={on.itemId} />
            {on.momentId === null ? null : (
              <input type="hidden" name="momentId" value={on.momentId} />
            )}
          </>
        )}
        <input type="hidden" name="back" value={back} />
        <textarea
          name="body"
          aria-label={`Note on ${about}`}
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
