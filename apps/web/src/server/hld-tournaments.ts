import {
  bracketSize,
  firstBracketRound,
  nextBracketRound,
  type Played,
  SWISS_ROUNDS,
  swissPairings,
  type TournamentStanding,
  tournamentStandings,
  universityScores,
} from "@interval/hld";
import { advance, type HldDeps, startHldMatch } from "./hld-matches";
import type { HldPairing, HldTournament, HldTournaments } from "./ports";

// P6-W43 (§6.4, Q-P6-07): a tournament, run by the admin round by round. Each round is
// 1v1 HLD matches (unrated: a cup has its own standings) on the round's problem; 5 Swiss
// rounds, then a seeded bracket of the top 8 (4 or 2 when fewer checked in).

export type TournamentDeps = HldDeps & { tournaments: HldTournaments };

const LAST_ROUND = 8; // the final

// A pairing's outcome once its match is scored: the winner (null: an exact tie, a draw,
// or no contest), whether it was contested at all (two designs that served nothing earn
// neither player a point), and each player's match score. Null while it's being played
// or its match hasn't been made yet.
async function outcome(
  deps: TournamentDeps,
  p: HldPairing,
): Promise<{
  winner: string | null;
  contested: boolean;
  totals: Map<string, number>;
} | null> {
  if (p.playerB === null)
    return { winner: p.playerA, contested: true, totals: new Map() }; // a bye
  if (p.matchId === null) return null;
  const found = await deps.matches.get(p.matchId);
  if (found?.match.scoredAt == null) return null;
  const totals = new Map(found.seats.map((s) => [s.userId, s.total ?? 0]));
  const contested = found.seats.some((s) => (s.simulationPoints ?? 0) > 0);
  const places = found.seats.map(
    (s) => [s.userId, s.place ?? Infinity] as const,
  );
  const best = Math.min(...places.map(([, place]) => place));
  const firsts = places.filter(([, place]) => place === best);
  return {
    winner: contested && firsts.length === 1 ? (firsts[0]?.[0] ?? null) : null,
    contested,
    totals,
  };
}

export type TournamentView = {
  tournament: HldTournament;
  standings: TournamentStanding[]; // the Swiss standings
  played: Played[]; // each checked-in player's Swiss record, for the next pairing
  universities: { university: string; score: number; counted: number }[];
  pairings: (HldPairing & { winner: string | null; done: boolean })[];
};

export async function viewTournament(
  deps: TournamentDeps,
  id: string,
): Promise<TournamentView | null> {
  const tournament = await deps.tournaments.get(id);
  if (tournament === null) return null;
  const [entries, pairings] = await Promise.all([
    deps.tournaments.entries(id),
    deps.tournaments.pairings(id),
  ]);
  const played = new Map<string, Played>(
    entries
      .filter((e) => e.checkedIn)
      .map((e) => [e.userId, { userId: e.userId, results: [] }]),
  );
  const shown: TournamentView["pairings"] = [];
  for (const p of pairings) {
    const o = await outcome(deps, p);
    shown.push({ ...p, winner: o?.winner ?? null, done: o !== null });
    if (o === null || p.round > SWISS_ROUNDS) continue;
    const record = (me: string, them: string | null) => {
      // A bye 1; no contest 0 each; a draw ½; otherwise the winner 1.
      const points =
        them === null
          ? 1
          : !o.contested
            ? 0
            : o.winner === null
              ? 0.5
              : o.winner === me
                ? 1
                : 0;
      played.get(me)?.results.push({
        opponent: them,
        points,
        total: o.totals.get(me) ?? 0,
      });
    };
    record(p.playerA, p.playerB);
    if (p.playerB !== null) record(p.playerB, p.playerA);
  }
  const standings = tournamentStandings([...played.values()]);
  const points = new Map(standings.map((s) => [s.userId, s.points]));
  return {
    tournament,
    standings,
    universities: universityScores(
      entries
        .filter((e) => e.checkedIn)
        .map((e) => ({
          userId: e.userId,
          university: e.university,
          points: points.get(e.userId) ?? 0,
        })),
    ),
    played: [...played.values()],
    pairings: shown,
  };
}

export type NextRound =
  | "started"
  | "finished"
  | "waiting" // the current round's matches aren't all scored
  | "too_few" // fewer than 2 checked in
  | "busy"; // another admin started it

export async function nextRound(
  deps: TournamentDeps,
  id: string,
): Promise<NextRound> {
  const t = await deps.tournaments.get(id);
  if (t === null || t.finishedAt !== null) return "finished";
  const rounds = await deps.tournaments.rounds(id);
  const current = (await deps.tournaments.pairings(id)).filter(
    (p) => p.round === t.round,
  );
  // A round claimed with pairings whose matches weren't all made (a crash, a queue
  // down) is finished starting first, never skipped.
  if (current.some((p) => p.playerB !== null && p.matchId === null)) {
    await startMatches(deps, t, rounds, current);
    return "started";
  }
  for (const p of current)
    if (p.matchId !== null) await advance(deps, p.matchId);
  const view = await viewTournament(deps, id);
  if (view === null) return "finished";
  if (view.pairings.some((p) => p.round === t.round && !p.done))
    return "waiting";
  const seeds = view.standings.map((s) => s.userId);
  if (t.round === 0 && seeds.length < 2) return "too_few";

  let to: number;
  let pairs: [string, string | null][];
  if (t.round < SWISS_ROUNDS) {
    to = t.round + 1;
    const { pairs: swiss, bye } = swissPairings(view.played);
    pairs = [
      ...swiss,
      ...(bye === null ? [] : [[bye, null] as [string, null]]),
    ];
  } else if (t.round === SWISS_ROUNDS) {
    const size = bracketSize(seeds.length);
    if (size === 0) return finish(deps, id);
    to = LAST_ROUND - Math.log2(size) + 1;
    pairs = firstBracketRound(seeds.slice(0, size));
  } else if (t.round < LAST_ROUND) {
    to = t.round + 1;
    const rank = new Map(seeds.map((s, i) => [s, i]));
    // An exact tie in the bracket goes to the higher seed (Q-P6-07).
    const winners = view.pairings
      .filter((p) => p.round === t.round)
      .map((p) => {
        if (p.winner !== null) return p.winner;
        const a = rank.get(p.playerA) ?? Infinity;
        const b =
          p.playerB === null ? Infinity : (rank.get(p.playerB) ?? Infinity);
        return a <= b ? p.playerA : (p.playerB ?? p.playerA);
      });
    pairs = nextBracketRound(winners);
  } else return finish(deps, id);

  // The round's problem before the claim, so a missing one can't strand the cup.
  if (!rounds.some((r) => r.round === to))
    throw new Error(`hld: tournament ${id} has no round ${String(to)}`);
  const pairings: HldPairing[] = pairs.map(([a, b], slot) => ({
    round: to,
    slot,
    playerA: a,
    playerB: b,
    matchId: null,
  }));
  if (!(await deps.tournaments.claimRound(id, t.round, to, pairings)))
    return "busy";
  await startMatches(deps, { ...t, round: to }, rounds, pairings);
  return "started";
}

// Each of the round's pairings without a match gets one, once (a second admin's match
// for the same pairing is never attached, and its players never see it).
async function startMatches(
  deps: TournamentDeps,
  t: HldTournament,
  rounds: { round: number; family: string; seed: number }[],
  pairings: HldPairing[],
): Promise<void> {
  const round = rounds.find((r) => r.round === t.round);
  if (round === undefined)
    throw new Error(`hld: tournament ${t.id} has no round ${String(t.round)}`);
  for (const p of pairings) {
    if (p.playerB === null || p.matchId !== null) continue;
    const matchId = await startHldMatch(
      deps,
      [p.playerA, p.playerB],
      t.league,
      {
        unrated: true,
        windowAt: null,
        variant: { family: round.family, seed: round.seed },
      },
    );
    await deps.tournaments.setMatch(t.id, t.round, p.slot, matchId);
  }
}

async function finish(deps: TournamentDeps, id: string): Promise<NextRound> {
  await deps.tournaments.finish(id, deps.now());
  return "finished";
}
