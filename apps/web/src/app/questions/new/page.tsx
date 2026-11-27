import { randomUUID } from "node:crypto";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { remainingToday, utcDay } from "../../../server/community";
import {
  communityQuestions,
  entitlements,
  sessionReader,
} from "../../../server/container";
import { BIGINT_ID, type CommunityState } from "../../../server/ports";
import { Card } from "../../ui/Card";
import { buttonClass } from "../../ui/Button";
import { INNER_PAGE_TITLE } from "../../ui/Page";
import { QuestionForm } from "./QuestionForm";
import { remainingText } from "./remaining";

export const dynamic = "force-dynamic";

const Query = z.object({ moment: z.string().regex(BIGINT_ID) });

// Where each of the player's questions stands; a rejection says why, so it can be
// rewritten (owner, 2026-11-27). The rules are the worker's (ARCH-2: one copy).
const STATES: Record<CommunityState, { text: string; problem: boolean }> = {
  checking: { text: "Waiting for its check.", problem: false },
  reviewing: { text: "Checked. Waiting for review.", problem: false },
  live: { text: "Approved.", problem: false },
  not_stand_alone: {
    text: 'Not accepted: it refers to its source ("the passage", "the article", "this section" …). Questions are shown on their own, so put the context it needs in the question itself.',
    problem: true,
  },
  not_quoted: {
    text: "Not accepted: the quote isn't the section's own words. Copy them exactly.",
    problem: true,
  },
  check: {
    text: "Not accepted: a second model, reading only the section, chose a different answer.",
    problem: true,
  },
  owner: { text: "Not accepted in review.", problem: true },
};

// Q-P7-05 (owner, 2026-11-27, §6.8): write a question at the end of a section you
// opened. It's checked by a second model, then reviewed by the owner, before anyone
// sees it, and it never shows who wrote it.
export default async function WriteQuestionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/join");
  // ADR-0029, Q-P7-05: guests can't submit.
  if (actor.isGuest) redirect("/sign-up");
  const parsed = Query.safeParse(await searchParams);
  if (!parsed.success) notFound();
  // ADR-0036 (OPS-3): a plan without it gets a 404.
  if (!(await entitlements().can(actor.userId, "questions.submit"))) notFound();
  const deps = {
    community: communityQuestions(),
    entitlements: entitlements(),
  };
  const section = await deps.community.section(
    actor.userId,
    parsed.data.moment,
  );
  if (section === null) notFound();
  const now = new Date();
  const [{ verified }, remaining, mine] = await Promise.all([
    deps.community.allowance(actor.userId, utcDay(now)),
    remainingToday(deps, actor.userId, now),
    deps.community.mine(actor.userId, section.momentId),
  ]);
  const left = remainingText(remaining);
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-5 px-4 pt-6 pb-16 lg:max-w-2xl lg:pt-10">
      <Link
        href="/"
        aria-label="Back to your feed"
        className="flex size-10 items-center justify-center rounded-full border border-hairline bg-page"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M15 5l-7 7 7 7" />
        </svg>
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className={INNER_PAGE_TITLE}>Write a question</h1>
        <p className="text-ink-muted">
          About{" "}
          <span className="font-semibold text-ink">
            {section.title === section.articleTitle
              ? section.articleTitle
              : `${section.title} — ${section.articleTitle}`}
          </span>
        </p>
      </div>
      <Card className="flex flex-col gap-4 p-5 lg:p-6">
        {verified ? (
          <>
            <p className="text-ink-muted">
              A multiple-choice question other players can answer from this
              section alone. A second model checks it, then it&apos;s reviewed
              before anyone sees it. Your name is never shown with it.
            </p>
            {left === null ? null : <p className="font-semibold">{left}</p>}
            {remaining === 0 ? null : (
              <QuestionForm
                momentId={section.momentId}
                idempotencyKey={randomUUID()}
              />
            )}
          </>
        ) : (
          <>
            <p>Verify your email to write questions.</p>
            <Link
              href="/profile#verify"
              className={`${buttonClass("secondary")} self-start`}
            >
              Verify your email
            </Link>
          </>
        )}
      </Card>
      {mine.length === 0 ? null : (
        <section aria-labelledby="yours" className="flex flex-col gap-3">
          <h2 id="yours" className="text-section">
            Your questions on this section
          </h2>
          <ul className="flex flex-col gap-2">
            {mine.map((q) => (
              <li
                key={q.questionId}
                className="rounded-2xl bg-well px-4 py-3 text-sm"
              >
                <p className="font-semibold">{q.stem}</p>
                <p
                  className={`mt-1 ${STATES[q.state].problem ? "text-wrong" : "text-ink-muted"}`}
                >
                  {STATES[q.state].text}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
