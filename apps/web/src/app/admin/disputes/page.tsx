import Link from "next/link";
import { adminDisputes } from "../../../server/container";
import { Card } from "../../ui/Card";
import { requireAdmin } from "../guard";
import { ACT, ADMIN_MAIN, SECONDARY } from "../style";
import { decideDisputeAction } from "./actions";

export const dynamic = "force-dynamic";

// P5-W35 (Q-P5-22): disputed battle results, oldest first, for the owner to uphold or
// dismiss with a note. Phase 5's "done when" wants under 3% of results disputed.
export default async function DisputesPage(props: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  await requireAdmin();
  const { saved, error } = await props.searchParams;
  const [disputes, rate] = await Promise.all([
    adminDisputes().pending(),
    adminDisputes().rate(),
  ]);
  return (
    <main className={ADMIN_MAIN}>
      <h1 className="text-title">Disputed results</h1>
      <p className="text-sm text-ink-muted">
        Last 30 days: {rate.disputed} of {rate.finished} finished battles
        disputed
        {rate.finished > 0
          ? ` (${((100 * rate.disputed) / rate.finished).toFixed(1)}%; the goal is under 3%)`
          : ""}
        .
      </p>
      {saved ? <p role="status">Saved.</p> : null}
      {error === "decided" ? (
        <p role="alert" className="text-wrong">
          That dispute was already decided.
        </p>
      ) : null}
      {disputes.length === 0 ? (
        <p className="text-ink-muted">Nothing to review.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {disputes.map((d) => (
            <li key={`${d.matchId}-${d.userId}`}>
              <Card className="flex flex-col gap-2 p-5 text-sm">
                <p>
                  <span className="font-semibold">{d.player}</span>
                  <span className="text-ink-muted">
                    {" "}
                    · {d.createdAt.toISOString().slice(0, 16)} UTC ·{" "}
                    <Link
                      href={`/play/battle/${d.matchId}/result`}
                      className="underline"
                    >
                      <code>{d.matchId}</code>
                    </Link>
                  </span>
                </p>
                <p className="whitespace-pre-wrap">{d.reason}</p>
                <form
                  action={decideDisputeAction}
                  className="flex flex-col gap-2"
                >
                  <input type="hidden" name="matchId" value={d.matchId} />
                  <input type="hidden" name="userId" value={d.userId} />
                  <textarea
                    name="note"
                    maxLength={1000}
                    aria-label="Note"
                    className="rounded-md border border-hairline p-2"
                  />
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      name="decision"
                      value="upheld"
                      className={ACT}
                    >
                      Uphold
                    </button>
                    <button
                      type="submit"
                      name="decision"
                      value="dismissed"
                      className={SECONDARY}
                    >
                      Dismiss
                    </button>
                  </div>
                </form>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
