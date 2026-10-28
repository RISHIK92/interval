import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { CHIPS } from "../../../../server/chips";
import { progress, quizzes, sessionReader } from "../../../../server/container";
import { outHref, readHref } from "../../../../server/outbound";
import { BIGINT_ID, checkpointHome } from "../../../../server/ports";
import { STATE_WORDS } from "../../../learnerState";
import {
  startBookCheckpointAction,
  startCheckpointAction,
} from "../../actions";

export const dynamic = "force-dynamic";

const Query = z.object({ chip: z.enum(CHIPS) });

// Test 60s results (P2-W9-S02; wireframe 14, variant test): how it went, each
// concept's state, and the next section. A checkpoint's (P2-W10-S04, Q-P2-26) says
// whether it passed and what that unlocked (a book chapter's, P2-W11-S06: what is now
// practiced), or offers another try.
export default async function ResultsPage({
  params,
  searchParams,
}: {
  params: Promise<{ attempt: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  const { attempt: attemptId } = await params;
  const parsed = Query.safeParse(await searchParams);
  if (!BIGINT_ID.test(attemptId) || !parsed.success) redirect("/");
  const { chip } = parsed.data;
  const attempt = await quizzes().attempt(actor.userId, attemptId);
  if (attempt === null) redirect("/");
  if (attempt.finishedAt === null) redirect(`/quiz/${attemptId}?chip=${chip}`);
  const { itemId, momentId, checkpoint } = attempt;
  // A review (P2-W9-S05) has no section to continue.
  const next =
    itemId === null || momentId === null
      ? null
      : await progress().nextMoment(itemId, momentId);
  // A sprint ends at its clock at the latest; a review whenever it was finished.
  const usedMs =
    Math.min(
      attempt.finishedAt.getTime(),
      attempt.endsAt?.getTime() ?? Infinity,
    ) - attempt.startedAt.getTime();
  const stats = [
    {
      value: `${String(Math.round((attempt.correct / Math.max(1, attempt.answered)) * 100))}%`,
      label: "Accuracy",
    },
    {
      value:
        attempt.avgMs === null ? "–" : `${(attempt.avgMs / 1000).toFixed(1)}s`,
      label: "Avg answer",
    },
    {
      value: `${String(Math.max(0, Math.round(usedMs / 1000)))}s`,
      label: "Time used",
    },
  ];
  const nextHref =
    next === null || itemId === null
      ? null
      : next.frameable
        ? readHref({
            itemId,
            momentId: next.momentId,
            chip,
            from: "continue",
          })
        : outHref({
            itemId,
            momentId: next.momentId,
            from: "continue",
            target: "section",
          });
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 px-4 pt-8 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <header className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-2xl font-semibold">
          {attempt.answered === 0
            ? "No answers this time"
            : `${String(attempt.correct)} of ${String(attempt.answered)} correct`}
        </h1>
        <p className="text-sm text-ink-muted">
          {attempt.review
            ? "Review"
            : checkpoint === null
              ? `Test yourself · ${attempt.title}`
              : `Checkpoint · ${attempt.title}`}
        </p>
      </header>
      {checkpoint === null ? null : checkpoint.passed ? (
        <div
          role="status"
          className="flex flex-col gap-1 rounded-2xl bg-go-soft px-4 py-3"
        >
          <p className="font-semibold">
            {checkpoint.at.kind === "book"
              ? checkpoint.concepts.length === 0
                ? "Passed."
                : `Passed: ${checkpoint.concepts.join(", ")} practiced.`
              : checkpoint.next === null
                ? "Passed. That's the whole path."
                : `Passed: ${checkpoint.next.join(", ")} unlocked.`}
          </p>
          {/* Owner, 2026-10-28: a pass's misses go to review too; say which. */}
          {checkpoint.missed.length === 0 ? null : (
            <p className="text-sm">
              In your review queue now: {checkpoint.missed.join(", ")}.
            </p>
          )}
        </div>
      ) : (
        <div
          role="status"
          className="flex flex-col gap-1 rounded-2xl bg-well px-4 py-3"
        >
          <p className="font-semibold">
            Not yet: {checkpoint.passMark} of {checkpoint.size} needed.
          </p>
          {checkpoint.missed.length === 0 ? null : (
            <p className="text-sm">
              In your review queue now: {checkpoint.missed.join(", ")}.
            </p>
          )}
        </div>
      )}
      {attempt.concepts.length === 0 ? null : (
        <ul className="flex flex-col gap-2">
          {attempt.concepts.map((c) => (
            <li
              key={c.name}
              className="flex items-center justify-between gap-3 rounded-2xl bg-well px-4 py-3"
            >
              <span className="font-semibold">{c.name}</span>
              <span className="text-sm">
                {c.state === null ? "Unseen" : STATE_WORDS[c.state]}
              </span>
            </li>
          ))}
        </ul>
      )}
      {attempt.answered === 0 ? null : (
        <dl className="grid grid-cols-3 gap-2 text-center">
          {stats.map((s) => (
            <div
              key={s.label}
              className="flex flex-col-reverse rounded-2xl border border-hairline p-3"
            >
              <dt className="text-xs text-ink-muted">{s.label}</dt>
              <dd className="text-lg font-semibold tabular-nums">{s.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {next === null || nextHref === null ? null : (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-ink-muted">Queued next</h2>
          <a
            href={nextHref}
            {...(next.frameable
              ? {}
              : { target: "_blank", rel: "noopener noreferrer" })}
            className="rounded-2xl border border-hairline px-4 py-3 font-semibold"
          >
            {next.title}
          </a>
        </section>
      )}
      <div className="mt-auto flex flex-col gap-2">
        {checkpoint === null || checkpoint.passed ? null : (
          <form
            action={
              checkpoint.at.kind === "path"
                ? startCheckpointAction
                : startBookCheckpointAction
            }
          >
            {checkpoint.at.kind === "path" ? (
              <input
                type="hidden"
                name="sectionId"
                value={checkpoint.at.sectionId}
              />
            ) : (
              <input
                type="hidden"
                name="chapterId"
                value={checkpoint.at.chapterId}
              />
            )}
            <input type="hidden" name="chip" value={chip} />
            <input
              type="hidden"
              name="back"
              value={checkpointHome(checkpoint.at)}
            />
            <button
              type="submit"
              className="inline-flex w-full cursor-pointer items-center justify-center rounded-full bg-ink px-5 py-3 font-semibold text-page"
            >
              Try again
            </button>
          </form>
        )}
        {nextHref === null ? null : (
          <a
            href={nextHref}
            {...(next?.frameable === true
              ? {}
              : { target: "_blank", rel: "noopener noreferrer" })}
            className="inline-flex items-center justify-center rounded-full bg-ink px-5 py-3 font-semibold text-page"
          >
            Continue reading
          </a>
        )}
        <a
          href={
            checkpoint !== null
              ? checkpointHome(checkpoint.at)
              : attempt.review
                ? "/library"
                : `/?chip=${chip}`
          }
          className={`inline-flex items-center justify-center rounded-full px-5 py-3 font-semibold ${
            checkpoint?.passed === true
              ? "bg-ink text-page"
              : "border border-hairline"
          }`}
        >
          {checkpoint !== null
            ? checkpoint.at.kind === "path"
              ? "Back to the path"
              : "Back to the book"
            : attempt.review
              ? "Back to Library"
              : "Back to feed"}
        </a>
      </div>
    </main>
  );
}
