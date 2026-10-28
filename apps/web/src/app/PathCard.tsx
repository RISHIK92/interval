import type { Chip } from "../server/chips";
import { type PathNext, QUIZ_SECONDS } from "../server/ports";
import { ReadingLink } from "./paths/ReadingLink";
import { SkipSection } from "./paths/SkipSection";
import { startCheckpointAction } from "./quiz/actions";
import { Card } from "./ui/Card";

const BUTTON =
  "mt-auto inline-flex cursor-pointer items-center justify-center self-start rounded-full bg-ink px-5 py-2.5 font-semibold text-page";

// P2-W10-S06 (REC-1, Q-P2-27): the active path's next step, the feed's first card.
// Like every card, it says why it's here (§5B).
export function PathCard({ next, chip }: { next: PathNext; chip: Chip }) {
  return (
    <article className="h-full">
      <Card className="flex h-full flex-col gap-3 p-5">
        <p className="text-sm font-semibold text-ink-muted">
          Next in your path:{" "}
          <a href={`/paths/${next.pathId}`} className="text-select">
            {next.pathName}
          </a>
        </p>
        {next.kind === "reading" ? (
          <>
            <h2 className="text-title">{next.reading.sectionTitle}</h2>
            <p className="text-ink-muted">
              {next.concepts.join(", ")} · reading {next.n} of {next.of} ·{" "}
              {next.reading.minutes} min · {next.reading.articleTitle}
            </p>
            <div className="mt-auto flex flex-wrap items-center gap-3">
              <ReadingLink
                reading={next.reading}
                label={`Read ${next.reading.sectionTitle}`}
                pathId={next.pathId}
                chip={chip}
                className={BUTTON}
              />
              {/* Q-P2-29: mastered already; nothing is skipped without a tap. */}
              {next.mastered ? (
                <>
                  <span
                    id={`known-${next.sectionId}`}
                    className="text-sm font-semibold"
                  >
                    You know this
                  </span>
                  <SkipSection
                    describedBy={`known-${next.sectionId}`}
                    sectionId={next.sectionId}
                    name={next.concepts.join(", ")}
                    reason="mastered"
                    back={`/?chip=${chip}`}
                  />
                </>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <h2 className="text-title">
              Checkpoint · {next.concepts.join(", ")}
            </h2>
            <p className="text-ink-muted">
              {QUIZ_SECONDS} seconds. Pass {next.passMark} of {next.size}{" "}
              {next.next === null
                ? "to finish the path."
                : `to unlock ${next.next.join(", ")}.`}
            </p>
            <form action={startCheckpointAction} className="mt-auto">
              <input type="hidden" name="sectionId" value={next.sectionId} />
              <input type="hidden" name="chip" value={chip} />
              <input type="hidden" name="back" value={`/?chip=${chip}`} />
              <button type="submit" className={BUTTON}>
                Take the checkpoint
              </button>
            </form>
          </>
        )}
      </Card>
    </article>
  );
}
