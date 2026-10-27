import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { CHIPS } from "../../../../server/chips";
import { progress, quizzes, sessionReader } from "../../../../server/container";
import { outHref, readHref } from "../../../../server/outbound";
import type { LearnerState } from "@interval/db";
import { BIGINT_ID } from "../../../../server/ports";

export const dynamic = "force-dynamic";

const Query = z.object({ chip: z.enum(CHIPS) });

// §3.1's states in words (shape and word, not colour alone: wireframe 08).
const STATE: Record<LearnerState, string> = {
  explored: "Explored",
  practiced: "Practiced",
  mastered: "Mastered",
  due_for_review: "Due for review",
};

// Test 60s results (P2-W9-S02; wireframe 14, variant test): how it went, each
// concept's state, and the next section.
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
  const next =
    attempt.momentId === null
      ? null
      : await progress().nextMoment(attempt.itemId, attempt.momentId);
  const usedMs =
    Math.min(attempt.finishedAt.getTime(), attempt.endsAt.getTime()) -
    attempt.startedAt.getTime();
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
    next === null
      ? null
      : next.frameable
        ? readHref({
            itemId: attempt.itemId,
            momentId: next.momentId,
            chip,
            from: "continue",
          })
        : outHref({
            itemId: attempt.itemId,
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
          Test yourself · {attempt.title}
        </p>
      </header>
      {attempt.concepts.length === 0 ? null : (
        <ul className="flex flex-col gap-2">
          {attempt.concepts.map((c) => (
            <li
              key={c.name}
              className="flex items-center justify-between gap-3 rounded-2xl bg-well px-4 py-3"
            >
              <span className="font-semibold">{c.name}</span>
              <span className="text-sm">
                {c.state === null ? "Unseen" : STATE[c.state]}
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
          href={`/?chip=${chip}`}
          className="inline-flex items-center justify-center rounded-full border border-hairline px-5 py-3 font-semibold"
        >
          Back to feed
        </a>
      </div>
    </main>
  );
}
