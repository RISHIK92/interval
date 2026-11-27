import { adminCommunity } from "../../../server/container";
import { Card } from "../../ui/Card";
import { requireAdmin } from "../guard";
import { ACT, ADMIN_MAIN, SECONDARY } from "../style";
import { decideCommunityAction } from "./actions";

const SAVED: Record<string, string> = {
  approve: "Approved. It's live; practice will ask it once W51's paths come.",
  reject: "Rejected.",
};

export const dynamic = "force-dynamic";

// Q-P7-05 (owner, 2026-11-27, §6.8): community questions the second model agreed
// with, the oldest first. One that disagreed was rejected and never comes here. Players
// never see who wrote one; the owner sees the author's username.
export default async function CommunityPage(props: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  await requireAdmin();
  const { saved, error } = await props.searchParams;
  const queue = await adminCommunity().open();
  return (
    <main className={ADMIN_MAIN}>
      <h1 className="text-title">Community questions</h1>
      {saved !== undefined && Object.hasOwn(SAVED, saved) ? (
        <Card className="px-4 py-3 text-sm">
          <p role="status">{SAVED[saved]}</p>
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
        <p className="text-ink-muted">Nothing to review.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {queue.map((q) => (
            <li key={q.questionId}>
              <Card className="flex flex-col gap-3 p-5 text-sm">
                <p className="text-ink-muted">
                  {q.author === null
                    ? "No username, or the author left"
                    : `@${q.author}`}{" "}
                  · {q.submittedAt.toISOString().slice(0, 10)} ·{" "}
                  <a
                    href={q.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    {`${q.sectionTitle} — ${q.articleTitle}`}
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
                <form action={decideCommunityAction} className="flex gap-2">
                  <input type="hidden" name="questionId" value={q.questionId} />
                  <button
                    type="submit"
                    name="decision"
                    value="approve"
                    className={ACT}
                  >
                    Approve
                  </button>
                  <button
                    type="submit"
                    name="decision"
                    value="reject"
                    className={SECONDARY}
                  >
                    Reject
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
