import { CUPS, FAMILIES, POOL } from "@interval/hld";
import Link from "next/link";
import { hldTournaments } from "../../../server/container";
import { Card } from "../../ui/Card";
import { requireAdmin } from "../guard";
import { ACT, ADMIN_MAIN, SECONDARY } from "../style";
import { createTournamentAction, nextRoundAction } from "./actions";
import { BATTLE_MODE_NAMES } from "../../battle-mode";

export const dynamic = "force-dynamic";

const SAID: Record<string, string> = {
  started: "The next round has started.",
  finished: "The tournament is finished.",
  waiting: "The current round's matches aren't all scored yet.",
  too_few: "Fewer than 2 players have checked in.",
  busy: "Another admin started that round.",
};
const ROUND_LABELS = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "Quarter-finals",
  "Semi-finals",
  "Final",
];

// P6-W43 (§6.4, HLDQ-3, Q-P6-07): HLD tournaments for the owner: make one (each round's
// problem picked from the pool, then retired from matches) and start each round once
// the one before is scored.
export default async function HldTournamentsAdmin(props: {
  searchParams: Promise<{ saved?: string; error?: string; round?: string }>;
}) {
  await requireAdmin();
  const { saved, error, round } = await props.searchParams;
  const all = await hldTournaments().list();
  // The hand-written cup problems first (W44), then both battle modes' pooled variants; the
  // form checks the pick against its battle mode.
  const options = [
    ...new Set([
      ...CUPS.flatMap((c) =>
        Object.values(c.seeds).map(
          (seed) => `${c.family.slug}/${String(seed)}`,
        ),
      ),
      ...FAMILIES.flatMap((f) =>
        (["human", "ai"] as const).flatMap((battleMode) =>
          (POOL[f.slug]?.[battleMode] ?? []).map(
            (seed) => `${f.slug}/${String(seed)}`,
          ),
        ),
      ),
    ]),
  ];
  return (
    <main className={ADMIN_MAIN}>
      <h1 className="text-title">HLD tournaments</h1>
      {saved ? <p role="status">Created.</p> : null}
      {error ? (
        <p role="alert" className="text-wrong">
          Check the form: a name, a start, and 8 different pooled problems for
          the battle mode.
        </p>
      ) : null}
      {round !== undefined && SAID[round] !== undefined ? (
        <p role="status">{SAID[round]}</p>
      ) : null}
      <ul className="flex flex-col gap-3">
        {all.map((t) => (
          <li key={t.id}>
            <Card className="flex flex-wrap items-center gap-3 p-4 text-sm">
              <Link
                href={`/hld/tournaments/${t.id}`}
                className="font-semibold underline"
              >
                {t.name}
              </Link>
              <span className="text-ink-muted">
                {BATTLE_MODE_NAMES[t.battleMode]} ·{" "}
                {t.startsAt.toISOString().slice(0, 16)} UTC ·{" "}
                {t.finishedAt !== null
                  ? "finished"
                  : `round ${String(t.round)}`}
              </span>
              {t.finishedAt === null ? (
                <form action={nextRoundAction}>
                  <input type="hidden" name="id" value={t.id} />
                  <button type="submit" className={SECONDARY}>
                    {t.round === 0 ? "Start round 1" : "Start the next round"}
                  </button>
                </form>
              ) : null}
            </Card>
          </li>
        ))}
      </ul>
      <Card className="p-5">
        <form
          action={createTournamentAction}
          className="flex flex-col gap-3 text-sm"
        >
          <h2 className="text-title">New tournament</h2>
          <label className="flex flex-col gap-1">
            Name
            <input
              name="name"
              required
              maxLength={80}
              className="rounded-md border border-hairline p-2"
            />
          </label>
          <label className="flex flex-col gap-1">
            Battle mode
            <select
              name="battleMode"
              className="self-start rounded-md border border-hairline p-1"
            >
              <option value="human">Human</option>
              <option value="ai">AI</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Starts (UTC); check-in opens an hour before
            <input
              type="datetime-local"
              name="startsAt"
              required
              className="self-start rounded-md border border-hairline p-1"
            />
          </label>
          <p className="text-ink-muted">
            Each round&apos;s problem, from the chosen battle mode&apos;s pool
            (family/seed). Each is used once, then retired from matches.
          </p>
          {ROUND_LABELS.map((label, i) => (
            <label key={label} className="flex items-center gap-2">
              <span className="w-28">Round {label}</span>
              <input
                name={`round${String(i + 1)}`}
                required
                list="hld-pool"
                className="rounded-md border border-hairline p-1"
              />
            </label>
          ))}
          <datalist id="hld-pool">
            {options.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
          <button type="submit" className={`self-start ${ACT}`}>
            Create
          </button>
        </form>
      </Card>
    </main>
  );
}
