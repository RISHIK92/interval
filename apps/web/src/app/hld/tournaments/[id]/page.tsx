import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import {
  entitlements,
  hldTournaments,
  sessionReader,
  tournamentDeps,
} from "../../../../server/container";
import { viewTournament } from "../../../../server/hld-tournaments";
import { checkInAction, registerAction, unregisterAction } from "./actions";
import { BATTLE_MODE_NAMES } from "../../../battle-mode";

export const dynamic = "force-dynamic";

const ROUND_NAMES: Record<number, string> = {
  6: "Quarter-finals",
  7: "Semi-finals",
  8: "Final",
};
const SAID: Record<string, string> = {
  closed: "Registration has closed: the tournament has started.",
  not_open: "Check-in opens an hour before the start, until the first round.",
  not_registered: "Register first.",
};

// P6-W43 (§6.4, Q-P6-07): a tournament: entering and checking in, the player's match this
// round, the Swiss standings, the university standings (each one's top 5 members), and
// the bracket.
export default async function TournamentPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ said?: string }>;
}) {
  const actor = await sessionReader().current(await headers());
  if (actor === null) redirect("/play");
  if (!(await entitlements().can(actor.userId, "play.hld"))) redirect("/play");
  const id = z.uuid().safeParse((await props.params).id);
  if (!id.success) notFound();
  const { said } = await props.searchParams;
  const view = await viewTournament(tournamentDeps(), id.data);
  if (view === null) notFound();
  const { tournament: t } = view;
  const entries = await hldTournaments().entries(id.data);
  const me = entries.find((e) => e.userId === actor.userId);
  const names = new Map(entries.map((e) => [e.userId, e.player]));
  const mine = view.pairings.find(
    (p) =>
      p.round === t.round &&
      (p.playerA === actor.userId || p.playerB === actor.userId),
  );
  // Q-P6-08: a round's players don't see each other's designs until the round is over.
  const shut = (round: number) =>
    view.pairings.some(
      (p) =>
        p.round === round &&
        (p.playerA === actor.userId || p.playerB === actor.userId),
    ) && view.pairings.some((p) => p.round === round && !p.done);
  const look = (p: { round: number; matchId: string | null; done: boolean }) =>
    p.matchId === null || shut(p.round) ? null : (
      <Link
        href={`/hld/match/${p.matchId}/${p.done ? "replay" : "watch"}`}
        className="underline"
      >
        {p.done ? "replay" : "watch"}
      </Link>
    );
  const name = (id: string | null) =>
    id === null ? "a bye" : (names.get(id) ?? id);
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 pt-6 pb-12">
      <header>
        <h1 className="text-display">{t.name}</h1>
        <p className="text-sm text-ink-muted">
          Starts {t.startsAt.toISOString().slice(0, 16).replace("T", " ")} UTC ·
          {BATTLE_MODE_NAMES[t.battleMode]} · 5 Swiss rounds, then the top 8 ·{" "}
          {entries.filter((e) => e.checkedIn).length} checked in of{" "}
          {entries.length}
        </p>
      </header>
      {said !== undefined && SAID[said] !== undefined ? (
        <p role="status">{SAID[said]}</p>
      ) : null}
      {t.round === 0 && t.finishedAt === null ? (
        <section className="flex flex-wrap items-center gap-3">
          {me === undefined ? (
            actor.isGuest ? (
              <p>Sign up to enter tournaments.</p>
            ) : (
              <form action={registerAction}>
                <input type="hidden" name="id" value={t.id} />
                <button
                  type="submit"
                  className="rounded-md bg-accent px-4 py-2 text-on-accent"
                >
                  Register
                </button>
              </form>
            )
          ) : (
            <>
              {me.checkedIn ? (
                <p>
                  You&apos;re checked in
                  {me.university === null ? "" : ` for ${me.university}`}.
                </p>
              ) : (
                <form action={checkInAction}>
                  <input type="hidden" name="id" value={t.id} />
                  <button
                    type="submit"
                    className="rounded-md bg-accent px-4 py-2 text-on-accent"
                  >
                    Check in
                  </button>
                </form>
              )}
              <form action={unregisterAction}>
                <input type="hidden" name="id" value={t.id} />
                <button
                  type="submit"
                  className="rounded-md border border-line px-4 py-2"
                >
                  Withdraw
                </button>
              </form>
            </>
          )}
        </section>
      ) : null}
      {mine === undefined ? null : (
        <p role="status" className="text-title">
          {ROUND_NAMES[t.round] ?? `Round ${String(t.round)}`}:{" "}
          {mine.matchId === null ? (
            "you have a bye (a win)."
          ) : (
            <Link href={`/hld/match/${mine.matchId}`} className="underline">
              your match against{" "}
              {name(
                mine.playerA === actor.userId ? mine.playerB : mine.playerA,
              )}
            </Link>
          )}
        </p>
      )}
      {t.round >= 1 && t.round <= 5 ? (
        <section>
          <h2 className="text-title">Round {t.round}</h2>
          <ul className="text-sm">
            {view.pairings
              .filter((p) => p.round === t.round && p.matchId !== null)
              .map((p) => (
                <li key={p.slot}>
                  {name(p.playerA)} v {name(p.playerB)}
                  {look(p) === null ? null : <> · {look(p)}</>}
                </li>
              ))}
          </ul>
        </section>
      ) : null}
      <section>
        <h2 className="text-title">Standings</h2>
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="text-left">
              <th>#</th>
              <th>Player</th>
              <th>Points</th>
              <th>Buchholz</th>
              <th>Match total</th>
            </tr>
          </thead>
          <tbody>
            {view.standings.map((s, i) => (
              <tr key={s.userId}>
                <td>{i + 1}</td>
                <td>{name(s.userId)}</td>
                <td>{s.points}</td>
                <td>{s.buchholz}</td>
                <td>{s.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {view.universities.length === 0 ? null : (
        <section>
          <h2 className="text-title">Universities</h2>
          <p className="text-sm text-ink-muted">
            Each university&apos;s top 5 members&apos; points.
          </p>
          <ol className="list-decimal pl-5 text-sm">
            {view.universities.map((u) => (
              <li key={u.university}>
                {u.university}: {u.score} ({u.counted} counted)
              </li>
            ))}
          </ol>
        </section>
      )}
      {view.pairings.some((p) => p.round > 5) ? (
        <section>
          <h2 className="text-title">Bracket</h2>
          {[6, 7, 8].map((round) => {
            const games = view.pairings.filter((p) => p.round === round);
            return games.length === 0 ? null : (
              <div key={round} className="mt-2">
                <h3 className="font-semibold">{ROUND_NAMES[round]}</h3>
                <ul className="text-sm">
                  {games.map((p) => (
                    <li key={p.slot}>
                      {name(p.playerA)} v {name(p.playerB)}
                      {look(p) === null ? null : <> · {look(p)}</>}
                      {p.done
                        ? p.winner === null
                          ? " · a tie: the higher seed goes through"
                          : ` · ${name(p.winner)} wins`
                        : " · playing"}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {t.finishedAt !== null ? (
            <p className="mt-2 font-semibold">Finished.</p>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
