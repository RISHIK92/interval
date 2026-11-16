import { describe, expect, test } from "vitest";
import {
  nextBracketRound,
  type Played,
  bracketSize,
  firstBracketRound,
  tournamentStandings,
  swissPairings,
  universityScores,
} from "./tournament";

// P6-W43 (§6.4, Q-P6-07): Swiss pairings, standings, the bracket, university scores.
const player = (
  userId: string,
  ...results: [string | null, number, number][]
): Played => ({
  userId,
  results: results.map(([opponent, points, total]) => ({
    opponent,
    points,
    total,
  })),
});

describe("standings", () => {
  test("points, then the opponents' points, then match scores", () => {
    const s = tournamentStandings([
      player("a", ["b", 1, 80]),
      player("b", ["a", 0, 60]),
      player("c", ["d", 1, 70]),
      player("d", ["c", 0, 50]),
    ]);
    expect(s.map((x) => x.userId)).toEqual(["a", "c", "b", "d"]);
    expect(s[0]).toEqual({ userId: "a", points: 1, buchholz: 0, total: 80 });
  });
});

describe("Swiss pairings", () => {
  test("round 1: down the field; an odd one out gets the bye", () => {
    const { pairs, bye } = swissPairings(
      ["a", "b", "c", "d", "e"].map((id) => player(id)),
    );
    expect(pairs).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(bye).toBe("e");
  });

  test("winners meet winners, never the same opponent twice, nobody a second bye", () => {
    const played = [
      player("a", ["b", 1, 80]),
      player("b", ["a", 0, 60]),
      player("c", ["d", 1, 70]),
      player("d", ["c", 0, 50]),
      player("e", [null, 1, 0]),
    ];
    const { pairs, bye } = swissPairings(played);
    expect(bye).toBe("d"); // the lowest-placed without a bye
    expect(pairs).toEqual([
      ["a", "c"],
      ["e", "b"],
    ]);
    for (const [x, y] of pairs)
      expect(
        played
          .find((p) => p.userId === x)
          ?.results.some((r) => r.opponent === y),
      ).toBe(false);
  });
});

describe("the bracket", () => {
  test("1 v 8, 4 v 5, 2 v 7, 3 v 6, then winners pair in order", () => {
    const qf = firstBracketRound([
      "s1",
      "s2",
      "s3",
      "s4",
      "s5",
      "s6",
      "s7",
      "s8",
    ]);
    expect(qf).toEqual([
      ["s1", "s8"],
      ["s4", "s5"],
      ["s2", "s7"],
      ["s3", "s6"],
    ]);
    expect(nextBracketRound(["s1", "s4", "s2", "s3"])).toEqual([
      ["s1", "s4"],
      ["s2", "s3"],
    ]);
    expect(nextBracketRound(["s1", "s2"])).toEqual([["s1", "s2"]]);
    expect(firstBracketRound(["s1", "s2", "s3", "s4"])).toEqual([
      ["s1", "s4"],
      ["s2", "s3"],
    ]);
    expect([9, 8, 7, 4, 3, 2, 1].map(bracketSize)).toEqual([
      8, 8, 4, 4, 2, 2, 0,
    ]);
  });
});

test("a university scores its top 5 members' points; players without one don't count", () => {
  const members = [
    ...[5, 4, 4, 3, 3, 3].map((points, i) => ({
      userId: `u${String(i)}`,
      university: "U1",
      points,
    })),
    { userId: "v", university: "U2", points: 5 },
    { userId: "w", university: null, points: 5 },
  ];
  expect(universityScores(members)).toEqual([
    { university: "U1", score: 19, counted: 5 },
    { university: "U2", score: 5, counted: 1 },
  ]);
});
