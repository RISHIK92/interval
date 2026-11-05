import { adminFairPlay } from "../../../server/container";
import type { FairPlaySignal, GameMode } from "../../../server/ports";
import { Card } from "../../ui/Card";
import { requireAdmin } from "../guard";
import { ACT, ADMIN_MAIN, SECONDARY } from "../style";
import { decideFairPlayAction } from "./actions";

export const dynamic = "force-dynamic";

const MODE: Record<GameMode, string> = {
  sprint: "Sprint",
  fastest_finger: "Fastest finger",
};

const describe = (s: FairPlaySignal) =>
  s.kind === "speed"
    ? `Round ${String(s.round)}: answered in ${String(s.ms ?? 0)} ms`
    : `Round ${String(s.round)}: left the tab`;

// P3-W18-S02 (§6.9, ADR-0006 C-14, Q-P3-20): players with 3 or more fair-play signals
// in a live match (an answer under 400 ms, a focus change in a live round). Flags come
// here before any penalty; a penalty removes the rating that match gained, never the
// account (owner, 2026-11-05).
export default async function FairPlayPage(props: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  await requireAdmin();
  const { saved, error } = await props.searchParams;
  const flags = await adminFairPlay().pending();
  return (
    <main className={ADMIN_MAIN}>
      <h1 className="text-title">Fair play</h1>
      <p className="text-sm text-ink-muted">
        Live matches where a player had 3 or more signals: an answer under 400
        ms after its question arrived, or leaving the tab during a round. A
        signal isn&apos;t proof; nothing happens until you decide.
      </p>
      {saved ? (
        <Card className="px-4 py-3 text-sm">
          <p role="status">Saved.</p>
        </Card>
      ) : null}
      {error === "decided" ? (
        <Card className="px-4 py-3 text-sm">
          <p role="alert" className="text-wrong">
            That flag was already decided.
          </p>
        </Card>
      ) : null}
      {flags.length === 0 ? (
        <p className="text-ink-muted">Nothing to review.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {flags.map((f) => (
            <li key={f.id}>
              <Card className="flex flex-col gap-2 p-5 text-sm">
                <p>
                  <span className="font-semibold">{f.player}</span>
                  <span className="text-ink-muted">
                    {" "}
                    · {MODE[f.mode]} · {f.playedAt.toISOString().slice(0, 16)}{" "}
                    UTC · <code>{f.matchId}</code>
                  </span>
                </p>
                <ul className="list-disc pl-5 tabular-nums">
                  {f.signals.map((s) => (
                    <li key={`${s.kind}-${String(s.round)}`}>{describe(s)}</li>
                  ))}
                </ul>
                <form action={decideFairPlayAction} className="flex gap-2">
                  <input type="hidden" name="flagId" value={f.id} />
                  <button
                    type="submit"
                    name="decision"
                    value="penalize"
                    className={ACT}
                  >
                    {f.gain > 0
                      ? `Remove the gain (${String(Math.round(f.gain))})`
                      : "Penalise (the match gained nothing)"}
                  </button>
                  <button
                    type="submit"
                    name="decision"
                    value="dismiss"
                    className={SECONDARY}
                  >
                    Dismiss
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
