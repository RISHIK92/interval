import type { ReviewReason } from "@interval/db";
import { adminQuestions } from "../../../server/container";
import { Card } from "../../ui/Card";
import { requireAdmin } from "../guard";
import { LEVEL_NAMES } from "../../ChoicesFields";
import { LEVELS } from "../../../server/ports";
import { ACT, ADMIN_MAIN, SECONDARY } from "../style";
import { decideAction, writeEstimateAction } from "./actions";

const FIELD = "rounded-xl border border-hairline bg-page px-3 py-1.5";
const ERRORS: Record<string, string> = {
  decided: "That question was already decided.",
  estimate:
    "That estimation question wasn't saved: check each field (the answer is a positive number, the source an http or https link).",
  concepts:
    "That estimation question wasn't saved: a concept slug isn't a live concept.",
};

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
  searchParams: Promise<{ saved?: string; written?: string; error?: string }>;
}) {
  await requireAdmin();
  const { saved, written, error } = await props.searchParams;
  const queue = await adminQuestions().open();
  return (
    <main className={ADMIN_MAIN}>
      <h1 className="text-title">Question spot checks</h1>
      {saved ? (
        <Card className="px-4 py-3 text-sm">
          <p role="status">Saved.</p>
        </Card>
      ) : null}
      {written ? (
        <Card className="px-4 py-3 text-sm">
          <p role="status">Estimation question saved. It&apos;s live.</p>
        </Card>
      ) : null}
      {error !== undefined && Object.hasOwn(ERRORS, error) ? (
        <Card className="px-4 py-3 text-sm">
          <p role="alert" className="text-wrong">
            {ERRORS[error]}
          </p>
        </Card>
      ) : null}
      {/* P3-W13-S03 (Q-P3-05 (b)): hand-written estimation questions, live at once,
        citing the page that states the number (AI-3). */}
      <details>
        <summary className="cursor-pointer font-semibold">
          Write an estimation question
        </summary>
        <Card className="mt-3 p-5 text-sm">
          <form
            action={writeEstimateAction}
            className="grid grid-cols-[10rem_1fr] items-center gap-3"
          >
            <label htmlFor="stem">Question</label>
            <input
              id="stem"
              name="stem"
              required
              maxLength={500}
              placeholder="How many writes per second can one Postgres box take?"
              className={FIELD}
            />
            <label htmlFor="answer">Answer</label>
            <input
              id="answer"
              name="answer"
              required
              inputMode="decimal"
              pattern="\d+(\.\d+)?"
              className={FIELD}
            />
            <label htmlFor="unit">Unit</label>
            <input
              id="unit"
              name="unit"
              required
              maxLength={40}
              placeholder="writes per second"
              className={FIELD}
            />
            <label htmlFor="concepts">Concept slugs</label>
            <input
              id="concepts"
              name="concepts"
              required
              placeholder="write-ahead-log, replication"
              className={FIELD}
            />
            <label htmlFor="difficulty">Difficulty</label>
            <select
              id="difficulty"
              name="difficulty"
              defaultValue="intermediate"
              className={FIELD}
            >
              {LEVELS.map((level) => (
                <option key={level} value={level}>
                  {LEVEL_NAMES[level]}
                </option>
              ))}
            </select>
            <label htmlFor="sourceUrl">Source link</label>
            <input
              id="sourceUrl"
              name="sourceUrl"
              type="url"
              required
              className={FIELD}
            />
            <label htmlFor="sourceTitle">Source title</label>
            <input
              id="sourceTitle"
              name="sourceTitle"
              required
              maxLength={300}
              className={FIELD}
            />
            <label htmlFor="citation">Quote stating the number</label>
            <textarea
              id="citation"
              name="citation"
              required
              maxLength={300}
              rows={2}
              className={FIELD}
            />
            <button
              type="submit"
              className={`${ACT} col-start-2 justify-self-start`}
            >
              Save, live
            </button>
          </form>
        </Card>
      </details>
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
                    {q.sectionTitle === null
                      ? q.articleTitle
                      : `${q.sectionTitle} — ${q.articleTitle}`}
                  </a>
                </p>
                <p className="text-base font-semibold">{q.stem}</p>
                {q.kind === "estimate" ? (
                  <>
                    <p>
                      Answer: {q.answer.toLocaleString("en-US")} {q.unit}
                    </p>
                    {q.validatorAnswer === null ? null : (
                      <p>
                        Validator: {q.validatorAnswer.toLocaleString("en-US")}{" "}
                        {q.unit}
                      </p>
                    )}
                  </>
                ) : (
                  <ol className="list-decimal pl-5">
                    {q.options.map((option, i) => (
                      <li key={option}>
                        {option}
                        {i === q.correct ? " (key)" : ""}
                        {i === q.validatorAnswer ? " (validator)" : ""}
                      </li>
                    ))}
                  </ol>
                )}
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
