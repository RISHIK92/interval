import type { ReactNode } from "react";
import type { PathNext, Streak } from "../server/ports";
import { reviewMinutes } from "./reviewTime";
import { streakText } from "./streakText";
import { RailCard } from "./ui/Page";

const icon = (path: ReactNode, size = "size-5") => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className={size}
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {path}
  </svg>
);

const PATH = icon(
  <path d="M6 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 19h8.5a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7H16" />,
  "size-6",
);
const REVIEW = icon(<path d="M4 7h12v13H4zM8 4h12v13" />);
const CHEVRON = icon(<path d="m9 18 6-6-6-6" />, "size-4 shrink-0");

const LABEL = "text-[13px] text-ink-muted";
const NAME = "text-[15px] font-semibold leading-tight";

// The design's right-hand column on wide screens (ADR-0019): the daily challenge's
// streak (Q-P3-07), your path (Week 10) and the review queue (Week 9) are live;
// booked battles arrive with a later phase, so that one shows greyed, with nothing
// made up.
export function ComingLater(props: {
  streak: Streak | null; // null: the plan has no daily challenge
  path: PathNext | null;
  due: number;
}) {
  const next =
    props.path === null
      ? null
      : props.path.kind === "reading"
        ? props.path.reading.sectionTitle
        : `Checkpoint · ${props.path.concepts.join(", ")}`;
  return (
    <>
      {props.streak === null ? null : (
        <RailCard
          href="/play"
          surface="border border-hairline bg-card shadow-card"
          className="flex flex-col gap-1"
        >
          <span className="text-base font-semibold">
            {streakText(props.streak) ?? "No streak yet"}
          </span>
          <span className={LABEL}>Daily challenge</span>
        </RailCard>
      )}
      <RailCard
        href={props.path === null ? "/paths" : `/paths/${props.path.pathId}`}
        className="flex items-center gap-3.5"
      >
        <span
          aria-hidden="true"
          className="flex h-15 w-12 shrink-0 items-center justify-center rounded-[10px] bg-(--distributed-systems-tint) text-(--distributed-systems-right)"
        >
          {PATH}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={LABEL}>Your path</span>
          {/* Null also for an active path with nothing next: no claim either way. */}
          <span className={NAME}>
            {props.path === null ? "See the paths" : props.path.pathName}
          </span>
          {next === null ? null : (
            <span className="truncate text-[13px] text-ink-soft">
              Next: {next}
            </span>
          )}
        </span>
      </RailCard>
      <RailCard
        href="/library#review-queue"
        surface={
          props.due === 0
            ? "border border-hairline bg-card"
            : "bg-(--review-tint)"
        }
        className="flex items-center gap-3"
      >
        <span
          aria-hidden="true"
          className={`flex size-10 shrink-0 items-center justify-center rounded-xl text-(--review-line) ${props.due === 0 ? "bg-well" : "bg-card"}`}
        >
          {REVIEW}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          {props.due === 0 ? (
            <>
              <span className={NAME}>Review queue</span>
              <span className={LABEL}>Nothing due</span>
            </>
          ) : (
            <>
              <span className={NAME}>
                {props.due === 1
                  ? "1 concept is fading"
                  : `${String(props.due)} concepts are fading`}
              </span>
              <span className="text-[13px] text-ink-soft">
                Review now · about {reviewMinutes(props.due)} min
              </span>
            </>
          )}
        </span>
        <span className="text-ink-soft">{CHEVRON}</span>
      </RailCard>
      <RailCard className="flex flex-col gap-1 opacity-50">
        <span className={LABEL}>Coming later</span>
        <span className={NAME}>Tonight’s battle</span>
      </RailCard>
    </>
  );
}
