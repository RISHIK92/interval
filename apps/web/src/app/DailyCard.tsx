import type { DailyStatus, Streak } from "../server/ports";
import { startDailyAction } from "./quiz/actions";
import { streakText } from "./streakText";
import { Card } from "./ui/Card";

const BUTTON =
  "cursor-pointer rounded-full bg-ink px-5 py-2.5 font-semibold text-page";

// P3-W13-S05 (§6.1): the feed's card for today's challenge, while it's still to play.
// Like every card, it says why it's here (§5B).
export function DailyCard({ streak }: { streak: Streak }) {
  const kept = streakText(streak);
  return (
    <article className="h-full">
      <Card className="flex h-full flex-col gap-2 p-5">
        <p className="text-sm text-ink-muted">Daily challenge</p>
        <h2 className="text-title">Today&apos;s 5 questions · 2 minutes</h2>
        <p className="text-ink">
          The same set for everyone today, one attempt.
          {kept === null ? null : ` Keep your ${kept}.`}
        </p>
        <form action={startDailyAction} className="mt-auto pt-2">
          <button type="submit" className={BUTTON}>
            Start today&apos;s challenge
          </button>
        </form>
      </Card>
    </article>
  );
}

// Play's daily challenge card (§6.3): start it, carry on, or see today's result and
// the streak (Q-P3-07).
export function DailyPlay({ status }: { status: DailyStatus }) {
  const { today } = status;
  const kept = streakText(status.streak);
  return (
    <div className="mt-auto flex flex-col gap-2 pt-2">
      {kept === null ? null : <p className="text-sm font-semibold">{kept}</p>}
      {today === "none" ? (
        <p className="text-sm text-ink-muted">No challenge today</p>
      ) : today === "open" || !today.finished ? (
        <form action={startDailyAction}>
          <button type="submit" className={BUTTON}>
            {today === "open"
              ? "Start today's challenge"
              : "Carry on with today's challenge"}
          </button>
        </form>
      ) : (
        <p className="text-sm">
          Today: {today.points} points ·{" "}
          <a
            href={`/quiz/${today.attemptId}/results?chip=3-8`}
            className="font-semibold underline underline-offset-2"
          >
            See your results
          </a>
        </p>
      )}
    </div>
  );
}
