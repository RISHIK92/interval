import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import {
  entitlements,
  hldTournaments,
  preferences,
  sessionReader,
  tournamentDeps,
} from "../../../../server/container";
import { viewTournament } from "../../../../server/hld-tournaments";
import { checkInAction, registerAction, unregisterAction } from "./actions";
import { BATTLE_MODE_NAMES } from "../../../battle-mode";
import { LOBBY_BUTTON } from "../../../LobbyCard";
import { Button } from "../../../ui/Button";
import { Card } from "../../../ui/Card";
import { PAGE_TITLE, Page } from "../../../ui/Page";

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
        className="font-semibold underline underline-offset-2"
      >
        {p.done ? "replay" : "watch"}
      </Link>
    );
  const name = (id: string | null) =>
    id === null ? "a bye" : (names.get(id) ?? id);
  const chosen = await preferences().get(actor.userId);
  return (
    <Page
      tab="play"
      phoneTabBar={false}
      firstName={chosen?.firstName ?? null}
      className="flex flex-col gap-6 lg:gap-5"
    >
      <header>
        <Link
          href="/hld/tournaments"
          className="text-sm text-ink-muted underline-offset-2 hover:underline"
        >
          Tournaments
        </Link>
        <h1 className={`mt-1 ${PAGE_TITLE}`}>{t.name}</h1>
        <p className="mt-1 text-sm text-ink-muted tabular-nums">
          Starts {t.startsAt.toISOString().slice(0, 16).replace("T", " ")} UTC ·
          {BATTLE_MODE_NAMES[t.battleMode]} · 5 Swiss rounds, then the top 8 ·{" "}
          {entries.filter((e) => e.checkedIn).length} checked in of{" "}
          {entries.length}
        </p>
      </header>
      {said !== undefined && SAID[said] !== undefined ? (
        <p role="status" className="rounded-2xl bg-well px-4 py-3 text-sm">
          {SAID[said]}
        </p>
      ) : null}
      {t.round === 0 && t.finishedAt === null ? (
        <Card className="flex flex-wrap items-center gap-3 p-5 lg:rounded-[22px] lg:p-[18px] lg:shadow-none">
          {me === undefined ? (
            actor.isGuest ? (
              <p>Sign up to enter tournaments.</p>
            ) : (
              <form action={registerAction}>
                <input type="hidden" name="id" value={t.id} />
                <Button type="submit" className={LOBBY_BUTTON}>
                  Register
                </Button>
              </form>
            )
          ) : (
            <>
              {me.checkedIn ? (
                <p className="font-semibold">
                  You&apos;re checked in
                  {me.university === null ? "" : ` for ${me.university}`}.
                </p>
              ) : (
                <form action={checkInAction}>
                  <input type="hidden" name="id" value={t.id} />
                  <Button type="submit" className={LOBBY_BUTTON}>
                    Check in
                  </Button>
                </form>
              )}
              <form action={unregisterAction}>
                <input type="hidden" name="id" value={t.id} />
                <Button
                  type="submit"
                  variant="secondary"
                  className={LOBBY_BUTTON}
                >
                  Withdraw
                </Button>
              </form>
            </>
          )}
        </Card>
      ) : null}
      {mine === undefined ? null : (
        <p
          role="status"
          className="rounded-[22px] bg-(--system-design-tint) px-5 py-4 text-section"
        >
          {ROUND_NAMES[t.round] ?? `Round ${String(t.round)}`}:{" "}
          {mine.matchId === null ? (
            "you have a bye (a win)."
          ) : (
            <Link
              href={`/hld/match/${mine.matchId}`}
              className="underline underline-offset-2"
            >
              your match against{" "}
              {name(
                mine.playerA === actor.userId ? mine.playerB : mine.playerA,
              )}
            </Link>
          )}
        </p>
      )}
      {t.round >= 1 && t.round <= 5 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-section">Round {t.round}</h2>
          <Card className="lg:rounded-[22px] lg:shadow-none">
            <ul className="text-sm">
              {view.pairings
                .filter((p) => p.round === t.round && p.matchId !== null)
                .map((p) => (
                  <li key={p.slot} className={LINE}>
                    {name(p.playerA)} v {name(p.playerB)}
                    {look(p) === null ? null : <> · {look(p)}</>}
                  </li>
                ))}
            </ul>
          </Card>
        </section>
      ) : null}
      <section className="flex flex-col gap-3">
        <h2 className="text-section">Standings</h2>
        <Card className="overflow-x-auto lg:rounded-[22px] lg:shadow-none">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="text-left text-[13px] text-ink-muted">
                <th className={`${CELL} font-medium`}>#</th>
                <th className={`${CELL} font-medium`}>Player</th>
                <th className={`${CELL} font-medium`}>Points</th>
                <th className={`${CELL} font-medium`}>Buchholz</th>
                <th className={`${CELL} font-medium`}>Match total</th>
              </tr>
            </thead>
            <tbody>
              {view.standings.map((s, i) => (
                <tr key={s.userId} className="border-t border-hairline">
                  <td className={`${CELL} text-ink-muted`}>{i + 1}</td>
                  <td className={`${CELL} font-semibold`}>{name(s.userId)}</td>
                  <td className={CELL}>{s.points}</td>
                  <td className={CELL}>{s.buchholz}</td>
                  <td className={CELL}>{s.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>
      {view.universities.length === 0 ? null : (
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-section">Universities</h2>
            <p className="text-sm text-ink-muted">
              Each university&apos;s top 5 members&apos; points.
            </p>
          </div>
          <Card className="lg:rounded-[22px] lg:shadow-none">
            <ol className="text-sm tabular-nums">
              {view.universities.map((u, i) => (
                <li key={u.university} className={LINE}>
                  <span className="mr-2 text-ink-muted">{i + 1}.</span>
                  {u.university}: {u.score} ({u.counted} counted)
                </li>
              ))}
            </ol>
          </Card>
        </section>
      )}
      {view.pairings.some((p) => p.round > 5) ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-section">Bracket</h2>
          {[6, 7, 8].map((round) => {
            const games = view.pairings.filter((p) => p.round === round);
            return games.length === 0 ? null : (
              <Card key={round} className="lg:rounded-[22px] lg:shadow-none">
                <h3 className="px-5 pt-4 font-semibold lg:px-[18px]">
                  {ROUND_NAMES[round]}
                </h3>
                <ul className="text-sm">
                  {games.map((p) => (
                    <li key={p.slot} className={LINE}>
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
              </Card>
            );
          })}
          {t.finishedAt !== null ? (
            <p className="font-semibold">Finished.</p>
          ) : null}
        </section>
      ) : null}
    </Page>
  );
}

// A row of a card's list, and a table cell, with the design's hairlines between.
const LINE = "border-t border-hairline px-5 py-3 first:border-t-0 lg:px-[18px]";
const CELL = "px-3 py-2.5 first:pl-5 last:pr-5 lg:first:pl-[18px]";
