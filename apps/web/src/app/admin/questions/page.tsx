import type { ReviewReason } from "@interval/db";
import { adminQuestions } from "../../../server/container";
import { Card } from "../../ui/Card";
import { requireAdmin } from "../guard";
import { ACT, ADMIN_MAIN, SECONDARY } from "../style";
import { decideAction } from "./actions";

// Why a question is in the queue (Q-2, Q-3): a user's flag, the weekly sample, or
// answers almost everyone gets right or wrong (P2-W9-S08).
const REASONS: Record<ReviewReason, string> = {
  flagged: "Flagged",
  sample: "Weekly sample",
  anomaly: "Unusual answers",
};

export const dynamic = "force-dynamic";

// Q-2, §6.8, P2-W8-S03: this week's spot checks (a random 10% of new live questions)
// and every flagged question. The quote is the passage the question was drafted from,
// for checking only: users never see it (Q-P2-12).
export default async function QuestionsPage(props: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  await requireAdmin();
  const { saved, error } = await props.searchParams;
  const queue = await adminQuestions().open();
  return (
    <main className={ADMIN_MAIN}>
      <h1 className="text-title">Question spot checks</h1>
      {saved ? (
        <Card className="px-4 py-3 text-sm">
          <p role="status">Saved.</p>
        </Card>
      ) : null}
      {error === "decided" ? (
        <Card className="px-4 py-3 text-sm">
          <p role="alert" className="text-wrong">
            That question was already decided.
          </p>
        </Card>
      ) : null}
      {queue.length === 0 ? (
        <p className="text-ink-muted">Nothing to check.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {queue.map((q) => (
            <li key={q.questionId}>
              <Card className="flex flex-col gap-3 p-5 text-sm">
                <p className="text-ink-muted">
                  {REASONS[q.reason]} ·{" "}
                  <a
                    href={q.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    {q.sectionTitle} — {q.articleTitle}
                  </a>
                </p>
                <p className="text-base font-semibold">{q.stem}</p>
                <ol className="list-decimal pl-5">
                  {q.options.map((option, i) => (
                    <li key={option}>
                      {option}
                      {i === q.correct ? " (key)" : ""}
                      {i === q.validatorAnswer ? " (validator)" : ""}
                    </li>
                  ))}
                </ol>
                <blockquote className="border-l-2 border-hairline pl-3 text-ink-muted">
                  {q.citation}
                </blockquote>
                <form action={decideAction} className="flex gap-2">
                  <input type="hidden" name="questionId" value={q.questionId} />
                  <button
                    type="submit"
                    name="decision"
                    value="keep"
                    className={ACT}
                  >
                    Keep
                  </button>
                  <button
                    type="submit"
                    name="decision"
                    value="retire"
                    className={SECONDARY}
                  >
                    Retire
                  </button>
                </form>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
