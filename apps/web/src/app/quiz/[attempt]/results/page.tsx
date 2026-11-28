import { AiDrafted } from "../../../ui/AiDrafted";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { quizzes, sessionReader } from "../../../../server/container";
import { missed, points } from "@interval/scoring";
import {
  BIGINT_ID,
  checkpointHome,
  type EstimateSource,
} from "../../../../server/ports";
import { STATE_WORDS } from "../../../learnerState";
import { amount, verdict } from "../../estimateText";
import { SourceAnchor, sourceLink } from "../../sourceLink";
import { StartQuiz } from "../../StartQuiz";
import { ShareButton } from "./ShareButton";
import {
  startBookCheckpointAction,
  startCheckpointAction,
} from "../../actions";

export const dynamic = "force-dynamic";

// Test 60s results (P2-W9-S02; wireframe 14, variant test): how it went, each
// concept's state, and (ADR-0058) the article's quiz offered again. A checkpoint's (P2-W10-S04, Q-P2-26) says
// whether it passed and what that unlocked (a book chapter's, P2-W11-S06: what is now
// practiced), or offers another try.
// ADR-0058: no chip rides along any more; a stray ?chip= from an old link is ignored.
export default async function ResultsPage({
  params,
}: {
  params: Promise<{ attempt: string }>;
}) {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  const { attempt: attemptId } = await params;
  if (!BIGINT_ID.test(attemptId)) redirect("/");
  const attempt = await quizzes().attempt(actor.userId, attemptId);
  if (attempt === null) redirect("/");
  if (attempt.finishedAt === null) redirect(`/quiz/${attemptId}`);
  const { itemId, checkpoint, estimation, daily } = attempt;
  // P3-W13-S05: the daily challenge scores in points, as estimation does, and lists
  // its estimates the same way.
  const scored = estimation ?? daily;
  // A game from Play goes back to Play.
  const game = attempt.sprint || daily !== null;
  // A sprint ends at its clock at the latest; a review whenever it was finished.
  const usedMs =
    Math.min(
      attempt.finishedAt.getTime(),
      attempt.endsAt?.getTime() ?? Infinity,
    ) - attempt.startedAt.getTime();
  const stats = [
    scored === null
      ? {
          value: `${String(Math.round((attempt.correct / Math.max(1, attempt.answered)) * 100))}%`,
          label: "Accuracy",
        }
      : {
          value: String(
            Math.round(scored.points / Math.max(1, attempt.answered)),
          ),
          label: "Points an answer",
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
  const link = (source: EstimateSource) => sourceLink(source, actor.isGuest);
  // §6.1 (owner, 2026-10-31): an estimate under half points sends its source back to
  // reading, once per page or article; a sprint's misses, their articles (ADR-0058).
  const readAgain = [
    ...new Map(
      [
        ...(scored?.answers ?? []).flatMap((a) =>
          a.source !== null && missed(a.score) ? [link(a.source)] : [],
        ),
        ...attempt.missed.map((m) => link({ kind: "article", ...m })),
      ].map((l) => [l.href, l]),
    ).values(),
  ];
  return (
    // Wide screens: full screen as the design's results (Battle results, web): the
    // score in a hero card, how it went on the left, what to read next and the
    // actions on the right. Phones keep one column.
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 px-4 pt-8 pb-[calc(1rem+env(safe-area-inset-bottom))] lg:grid lg:min-h-0 lg:max-w-[72rem] lg:grid-cols-2 lg:content-start lg:items-start lg:gap-5 lg:px-8 lg:pt-7 lg:pb-12">
      <header className="flex flex-col items-center gap-1 text-center lg:col-span-2 lg:items-start lg:gap-1.5 lg:rounded-[22px] lg:border lg:border-hairline lg:bg-card lg:px-8 lg:py-7 lg:text-left lg:shadow-card">
        <h1 className="text-2xl font-semibold lg:text-[40px] lg:leading-[1.1] lg:font-bold lg:tracking-[-0.03em]">
          {attempt.answered === 0
            ? "No answers this time"
            : scored !== null
              ? `${String(scored.points)} points`
              : `${String(attempt.correct)} of ${String(attempt.answered)} correct`}
        </h1>
        <p className="text-sm text-ink-muted lg:text-[15px]">
          {attempt.review
            ? "Review"
            : game
              ? attempt.title
              : checkpoint === null
                ? `Test yourself · ${attempt.title}`
                : `Checkpoint · ${attempt.title}`}
        </p>
      </header>
      {/* Phones: the two columns' children sit in the one column as they are. */}
      <div className="contents lg:flex lg:flex-col lg:gap-4">
        {checkpoint === null ? null : checkpoint.passed ? (
          <div
            role="status"
            className="flex flex-col gap-1 rounded-2xl bg-go-soft px-4 py-3 lg:rounded-[18px] lg:px-5 lg:py-4"
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
            className="flex flex-col gap-1 rounded-2xl bg-well px-4 py-3 lg:rounded-[18px] lg:px-5 lg:py-4"
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
          <ul className="flex flex-col gap-2 lg:gap-0 lg:rounded-[20px] lg:border lg:border-hairline lg:bg-card lg:px-5 lg:py-1 lg:shadow-card">
            {attempt.concepts.map((c) => (
              <li
                key={c.name}
                className="flex items-center justify-between gap-3 rounded-2xl bg-well px-4 py-3 lg:rounded-none lg:border-b lg:border-hairline lg:bg-transparent lg:px-0 lg:last:border-b-0"
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
                className="flex flex-col-reverse rounded-2xl border border-hairline p-3 lg:rounded-[18px] lg:bg-card lg:py-4 lg:shadow-card"
              >
                <dt className="text-xs text-ink-muted lg:text-[13px]">
                  {s.label}
                </dt>
                <dd className="text-lg font-semibold tabular-nums lg:text-[26px] lg:font-bold lg:tracking-[-0.02em]">
                  {s.value}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {/* Q-P3-07: the streak after today's challenge, and a freeze once earned. */}
        {daily === null ? null : (
          <p
            role="status"
            className="rounded-2xl bg-well px-4 py-3 text-center lg:rounded-[18px]"
          >
            <span className="font-semibold">
              {daily.streak.days === 1
                ? "1-day streak"
                : `${String(daily.streak.days)}-day streak`}
            </span>
            {daily.streak.freezes > 0 ? " · a freeze held" : null}
          </p>
        )}
        {/* P3-W13-S06 (§6.3): the result shares as a card that shows no question. */}
        {daily === null ? null : <ShareButton shareId={daily.shareId} />}
      </div>
      <div className="contents lg:flex lg:flex-col lg:gap-4">
        {/* P3-W13-S04 (C-27, AI-3): each estimate against the real answer, and where
        it comes from. */}
        {scored === null || scored.answers.length === 0 ? null : (
          <ol className="flex flex-col gap-2">
            {scored.answers.map((a) => (
              <li
                key={a.questionId}
                className="flex flex-col gap-1 rounded-2xl bg-well px-4 py-3 lg:rounded-[18px] lg:border lg:border-hairline lg:bg-card lg:px-5 lg:py-4"
              >
                <p className="font-semibold">
                  {a.stem}
                  {a.aiDrafted ? <AiDrafted /> : null}
                </p>
                <p className="text-sm">
                  Your guess {amount(a.guess, a.unit)} · Answer{" "}
                  {amount(a.answer, a.unit)}
                </p>
                <p className="text-sm font-semibold">
                  {verdict(a.score)}: {points(a.score)} points
                </p>
                {a.source === null ? null : (
                  <SourceAnchor
                    link={link(a.source)}
                    className="text-sm text-ink-muted underline underline-offset-2"
                  />
                )}
              </li>
            ))}
          </ol>
        )}
        {/* §6.1: what a game missed goes back to reading. The in-app reader is for
        accounts (ADR-0029), so a guest opens the publisher's page. */}
        {readAgain.length === 0 ? null : (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-ink-muted lg:text-section lg:text-ink">
              Read again
            </h2>
            <ul className="flex flex-col gap-2">
              {readAgain.map((l) => (
                <li key={l.href}>
                  <SourceAnchor
                    link={l}
                    className="block rounded-2xl border border-hairline px-4 py-3 font-semibold lg:rounded-[18px] lg:bg-card lg:px-5 lg:py-4 lg:hover:border-hairline-strong"
                  />
                </li>
              ))}
            </ul>
          </section>
        )}
        <div className="mt-auto flex flex-col gap-2 lg:mt-1 lg:flex-row lg:flex-wrap lg:items-center lg:gap-2.5">
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
              <input
                type="hidden"
                name="back"
                value={checkpointHome(checkpoint.at)}
              />
              <button
                type="submit"
                className="inline-flex w-full cursor-pointer items-center justify-center rounded-full bg-ink px-5 py-3 font-semibold text-page lg:h-12 lg:w-auto lg:px-6 lg:py-0"
              >
                Try again
              </button>
            </form>
          )}
          {/* ADR-0058: an article's quiz is always on offer, so it can be taken
          again straight from its results. */}
          {itemId === null ? null : (
            <StartQuiz
              itemId={itemId}
              back={`/quiz/${attemptId}/results`}
              className="inline-flex w-full items-center justify-center rounded-full bg-ink px-5 py-3 font-semibold text-page lg:h-12 lg:w-auto lg:px-6 lg:py-0"
            >
              Quiz me again
            </StartQuiz>
          )}
          <a
            href={
              checkpoint !== null
                ? checkpointHome(checkpoint.at)
                : attempt.review
                  ? "/library"
                  : game
                    ? "/play"
                    : "/"
            }
            className={`inline-flex items-center justify-center rounded-full px-5 py-3 font-semibold lg:h-12 lg:px-6 lg:py-0 ${
              checkpoint?.passed === true
                ? "bg-ink text-page"
                : "border border-hairline lg:border-[1.5px] lg:border-hairline-strong"
            }`}
          >
            {checkpoint !== null
              ? checkpoint.at.kind === "path"
                ? "Back to the path"
                : "Back to the book"
              : attempt.review
                ? "Back to Library"
                : game
                  ? "Back to Play"
                  : "Back to feed"}
          </a>
        </div>
      </div>
    </main>
  );
}
