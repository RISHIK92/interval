import type { Chip } from "../server/chips";
import type { ReasonKind } from "../server/ports";
import { feedbackAction } from "./feedback/actions";
import { StartQuiz, ZAP } from "./quiz/StartQuiz";

// Round icon buttons beside the card's pill (design screen 2).
const ROUND =
  "flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full border border-hairline bg-page text-ink";
const MENU_ITEM =
  "w-full rounded-xl px-3 py-2 text-left hover:bg-well focus-visible:bg-well";

// ADR-0026/0027: how each reason is named when reporting it. Kinds the worker no
// longer states (topic, level, length) stay for reports made before ADR-0027.
const REASON_LABELS: Record<ReasonKind, string> = {
  explore: "Something new to try",
  topic_match: "Your topics",
  goal_match: "Your goal",
  project_match: "Your project",
  level_fit: "Your level",
  time_fit: "Its length",
  quality: "A trusted source",
  freshness: "New this week",
};

// ADR-0006 C-20: Save on the card; the other controls in its overflow menu. One form
// per card: the pressed button names the control (no client script needed).
export function CardControls({
  itemId,
  title,
  saved,
  chip,
  originalHref,
  test,
  reasons = [],
}: {
  itemId: string;
  title: string;
  saved: boolean;
  chip: Chip;
  // A section's article page from the top (§5D); none for a whole-article card, whose
  // Read article already is that page.
  originalHref: string | null;
  // P2-W9-S02: Test 60s on the card's section (or article), when it has questions.
  test: { momentId: string | null } | null;
  // ADR-0027: the reason the card's explanation states, to report it as wrong.
  reasons?: ReasonKind[];
}) {
  // Every card has these buttons: the title tells them apart for a screen reader. The
  // Save button is only an icon, so its label is its whole name.
  return (
    <div className="flex shrink-0 items-center gap-2">
      {test === null ? null : (
        <StartQuiz
          itemId={itemId}
          momentId={test.momentId}
          chip={chip}
          back={`/?chip=${chip}`}
          label={`Test yourself: ${title}`}
          className={ROUND}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="size-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          >
            <path d={ZAP} />
          </svg>
        </StartQuiz>
      )}
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
            {originalHref === null ? null : (
              <a
                href={originalHref}
                target="_blank"
                rel="noopener noreferrer"
                className={`block ${MENU_ITEM}`}
              >
                Open original website
              </a>
            )}
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
            {reasons.length === 0 ? null : (
              <details>
                <summary
                  className={`${MENU_ITEM} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
                >
                  A reason is wrong
                </summary>
                <div className="flex flex-col pl-3">
                  {reasons.map((reason) => (
                    <button
                      key={reason}
                      type="submit"
                      name="control"
                      value={`wrong_reason:${reason}`}
                      className={`${MENU_ITEM} text-sm`}
                    >
                      {REASON_LABELS[reason]}
                    </button>
                  ))}
                </div>
              </details>
            )}
          </div>
        </details>
      </form>
    </div>
  );
}
