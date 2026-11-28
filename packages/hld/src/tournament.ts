// P6-W43 (§6.4, Q-P6-07): a tournament's rules, as pure functions: Swiss pairings, the
// standings with their tiebreaks, the top-8 bracket, and the university scores.

export const SWISS_ROUNDS = 5;
export const BRACKET_SIZE = 8;
const UNIVERSITY_TOP = 5; // §6.4: a university's top 5 members

// One player's Swiss record: each round's result against whom (null: a bye).
export type Played = {
  userId: string;
  results: { opponent: string | null; points: number; total: number }[];
};

export type TournamentStanding = {
  userId: string;
  points: number; // 1 a win or a bye, ½ a draw
  buchholz: number; // the opponents' points: the strength of the schedule
  total: number; // the match scores, summed
};

export function tournamentStandings(players: Played[]): TournamentStanding[] {
  const points = new Map(
    players.map((p) => [p.userId, p.results.reduce((a, r) => a + r.points, 0)]),
  );
  return players
    .map((p) => ({
      userId: p.userId,
      points: points.get(p.userId) ?? 0,
      // A bye has no opponent, so it adds nothing here (though it's worth a point).
      buchholz: p.results.reduce(
        (a, r) => a + (r.opponent === null ? 0 : (points.get(r.opponent) ?? 0)),
        0,
      ),
      total: Math.round(p.results.reduce((a, r) => a + r.total, 0) * 10) / 10,
    }))
    .sort(
      (a, b) =>
        b.points - a.points ||
        b.buchholz - a.buchholz ||
        b.total - a.total ||
        a.userId.localeCompare(b.userId),
    );
}

// A round's pairings, greedily: down the standings, each player with the next they
// haven't met (a rematch only when none is left for them, which a fuller search could
// sometimes avoid); with an odd count, the lowest-placed player without a bye sits out
// with one.
export function swissPairings(players: Played[]): {
  pairs: [string, string][];
  bye: string | null;
} {
  const order = tournamentStandings(players).map((s) => s.userId);
  const met = new Map(
    players.map((p) => [p.userId, new Set(p.results.map((r) => r.opponent))]),
  );
  let bye: string | null = null;
  if (order.length % 2 === 1) {
    const hadBye = (id: string) => met.get(id)?.has(null) ?? false;
    bye =
      [...order].reverse().find((id) => !hadBye(id)) ?? order.at(-1) ?? null;
  }
  const left = order.filter((id) => id !== bye);
  const pairs: [string, string][] = [];
  while (left.length > 1) {
    const a = left.shift() ?? "";
    const fresh = left.findIndex((b) => !(met.get(a)?.has(b) ?? false));
    const [b = ""] = left.splice(fresh === -1 ? 0 : fresh, 1);
    pairs.push([a, b]);
  }
  return { pairs, bye };
}

// The bracket's first round from the top seeds: 8 play the quarter-finals (1 v 8, 4 v 5,
// 2 v 7, 3 v 6), 4 the semi-finals (1 v 4, 2 v 3), 2 the final, so the top two seeds
// can only meet in the final. Fewer than 8 checked in starts it later (Q-P6-07).
export function bracketSize(players: number): number {
  return players >= BRACKET_SIZE
    ? BRACKET_SIZE
    : players >= 4
      ? 4
      : players >= 2
        ? 2
        : 0;
}
export function firstBracketRound(seeds: string[]): [string, string][] {
  const s = (n: number) => seeds[n - 1] ?? "";
  if (seeds.length >= 8)
    return [
      [s(1), s(8)],
      [s(4), s(5)],
      [s(2), s(7)],
      [s(3), s(6)],
    ];
  if (seeds.length >= 4)
    return [
      [s(1), s(4)],
      [s(2), s(3)],
    ];
  return [[s(1), s(2)]];
}

// The next bracket round from the last one's winners, in bracket order.
export function nextBracketRound(winners: string[]): [string, string][] {
  const pairs: [string, string][] = [];
  for (let i = 0; i + 1 < winners.length; i += 2)
    pairs.push([winners[i] ?? "", winners[i + 1] ?? ""]);
  return pairs;
}

// §6.4: a university's score is its top 5 members' points.
export function universityScores(
  members: { userId: string; university: string | null; points: number }[],
): { university: string; score: number; counted: number }[] {
  const by = new Map<string, number[]>();
  for (const m of members)
    if (m.university !== null)
      by.set(m.university, [...(by.get(m.university) ?? []), m.points]);
  return [...by]
    .map(([university, points]) => {
      const top = [...points].sort((a, b) => b - a).slice(0, UNIVERSITY_TOP);
      return {
        university,
        score: top.reduce((a, p) => a + p, 0),
        counted: top.length,
      };
    })
    .sort(
      (a, b) => b.score - a.score || a.university.localeCompare(b.university),
    );
}
