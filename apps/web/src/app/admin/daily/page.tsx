import Link from "next/link";
import { adminDaily } from "../../../server/container";
import type { DailySet } from "../../../server/ports";
import { Card } from "../../ui/Card";
import { requireAdmin } from "../guard";
import { ACT, ADMIN_MAIN, SECONDARY, TABLE } from "../style";
import { approveDailyAction, swapDailyAction } from "./actions";

export const dynamic = "force-dynamic";

const SAVED: Record<string, string> = {
  approved: "Tomorrow's set is approved.",
  swapped: "Swapped.",
};
const ERRORS: Record<string, string> = {
  started: "That day has started: its set can't change now.",
  swap: "Nothing else fits that slot: another question of its kind, on concepts the rest don't test, unused within 30 days.",
};

// P3-W13-S05 (Q-2 as ADR-0031 amends it, Q-P3-06): tomorrow's daily challenge, for
// the owner's review. A set not approved by 00:00 UTC still goes out, and its
// questions join the spot-check queue; a banner says so.
export default async function DailyPage(props: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  await requireAdmin();
  const { saved, error } = await props.searchParams;
  const { today, tomorrow } = await adminDaily().sets();
  return (
    <main className={ADMIN_MAIN}>
      <h1 className="text-title">Daily challenge</h1>
      {today?.publishedUnreviewed === true ? (
        <Card className="px-4 py-3 text-sm">
          <p role="alert">
            Today&apos;s set went out without your review. Its questions are in{" "}
            <Link href="/admin/questions" className="font-semibold underline">
              the review queue
            </Link>
            .
          </p>
        </Card>
      ) : null}
      {saved !== undefined && Object.hasOwn(SAVED, saved) ? (
        <Card className="px-4 py-3 text-sm">
          <p role="status">{SAVED[saved]}</p>
        </Card>
      ) : null}
      {error !== undefined && Object.hasOwn(ERRORS, error) ? (
        <Card className="px-4 py-3 text-sm">
          <p role="alert" className="text-wrong">
            {ERRORS[error]}
          </p>
        </Card>
      ) : null}
      <section className="flex flex-col gap-3">
        <h2 className="text-section">Tomorrow</h2>
        {tomorrow === null ? (
          <p className="text-ink-muted">
            Not picked yet: <code>daily-challenge-due</code> picks it at 00:00
            UTC.
          </p>
        ) : (
          <>
            <p className="text-sm text-ink-muted">
              {tomorrow.day} · {tomorrow.questions.length} of 5 questions ·{" "}
              {tomorrow.approved ? "approved" : "not approved yet"}
            </p>
            <SetTable set={tomorrow} swap />
            {tomorrow.approved ? null : (
              <form action={approveDailyAction}>
                <input type="hidden" name="day" value={tomorrow.day} />
                <button type="submit" className={ACT}>
                  Approve tomorrow&apos;s set
                </button>
              </form>
            )}
          </>
        )}
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-section">Today</h2>
        {today === null ? (
          <p className="text-ink-muted">No set today.</p>
        ) : (
          <>
            <p className="text-sm text-ink-muted">
              {today.day} ·{" "}
              {today.approved
                ? "approved"
                : today.publishedUnreviewed
                  ? "went out unreviewed"
                  : "not approved"}
            </p>
            <SetTable set={today} swap={false} />
          </>
        )}
      </section>
    </main>
  );
}

function SetTable({ set, swap }: { set: DailySet; swap: boolean }) {
  return (
    <table className={TABLE}>
      <thead>
        <tr>
          <th>#</th>
          <th>Kind</th>
          <th>Question</th>
          <th>Concepts</th>
          <th>Source</th>
          {swap ? <th /> : null}
        </tr>
      </thead>
      <tbody>
        {set.questions.map((q) => (
          <tr key={q.position}>
            <td>{q.position + 1}</td>
            <td>{q.kind === "choice" ? "Multiple choice" : "Estimate"}</td>
            <td>
              {q.stem}
              {q.status === "live" ? null : (
                <span className="text-ink-muted"> ({q.status}: skipped)</span>
              )}
            </td>
            <td>{q.concepts.join(", ")}</td>
            <td>{q.source}</td>
            {swap ? (
              <td>
                <form action={swapDailyAction}>
                  <input type="hidden" name="day" value={set.day} />
                  <input type="hidden" name="position" value={q.position} />
                  <button type="submit" className={SECONDARY}>
                    Swap
                  </button>
                </form>
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
