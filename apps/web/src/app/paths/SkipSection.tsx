import { editPathAction } from "./actions";

const SECONDARY =
  "cursor-pointer rounded-full border border-hairline px-3 py-1.5 text-sm font-semibold";

// S05's Skip (Q-P2-23), asked first in a native popover: no script, no browser
// dialog. Edit mode offers it (reason user); a mastered section suggests it, on the
// path page and the feed's path card (P2-W10-S07, Q-P2-29). PER-1: nothing is skipped
// without a tap, so Keep it stores nothing.
export function SkipSection(props: {
  sectionId: string;
  name: string;
  reason: "user" | "mastered";
  back: string;
  // The suggestion's reason ("You know this"), for screen readers.
  describedBy?: string;
}) {
  const confirm = `skip-${props.reason}-${props.sectionId}`;
  return (
    <>
      <button
        type="button"
        popoverTarget={confirm}
        aria-label={`Skip section ${props.name}`}
        aria-describedby={props.describedBy}
        className={SECONDARY}
      >
        Skip section
      </button>
      <div
        id={confirm}
        popover="auto"
        role="alertdialog"
        aria-labelledby={`${confirm}-title`}
        className="m-auto w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-hairline bg-page p-5 text-ink shadow-card backdrop:bg-black/40"
      >
        <p id={`${confirm}-title`} className="font-semibold">
          Skip {props.name}?
        </p>
        <p className="mt-1 text-sm text-ink-muted">
          The next section opens. Skipping doesn&apos;t mark these concepts
          practiced; you can unskip it later.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <form action={editPathAction}>
            <input type="hidden" name="edit" value="skip" />
            <input type="hidden" name="sectionId" value={props.sectionId} />
            <input type="hidden" name="reason" value={props.reason} />
            <input type="hidden" name="back" value={props.back} />
            <button
              type="submit"
              className="w-full cursor-pointer rounded-full border border-wrong px-5 py-3 font-semibold"
            >
              Skip section
            </button>
          </form>
          <button
            type="button"
            autoFocus
            popoverTarget={confirm}
            popoverTargetAction="hide"
            className="w-full cursor-pointer rounded-full bg-ink px-5 py-3 font-semibold text-page"
          >
            Keep it
          </button>
        </div>
      </div>
    </>
  );
}
