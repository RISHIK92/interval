import { describe, expect, test, vi } from "vitest";
import {
  nextRound,
  type TournamentDeps,
  viewTournament,
} from "./hld-tournaments";
import type {
  HldEntry,
  HldMatch,
  HldMatches,
  HldPairing,
  HldSeat,
  HldTournament,
  HldTournaments,
} from "./ports";

// P6-W43 (§6.4, Q-P6-07): a tournament round by round: 5 Swiss rounds of 1v1 matches
// (an odd one out gets a bye), then a seeded bracket (4 here: semi-finals and a final),
// each round started once the one before is scored.

type Match = { match: HldMatch; seats: HldSeat[] };

function world(players: string[], universities: Record<string, string>) {
  const matches = new Map<string, Match>();
  let tournament: HldTournament = {
    id: "t1",
    name: "Cup",
    battleMode: "human",
    startsAt: new Date("2026-11-20T18:00:00Z"),
    round: 0,
    finishedAt: null,
  };
  const pairings: HldPairing[] = [];
  const entries: HldEntry[] = players.map((userId) => ({
    userId,
    player: userId,
    checkedIn: true,
    university: universities[userId] ?? null,
  }));
  const seat = (userId: string): HldSeat => ({
    userId,
    player: userId,
    submittedAt: null,
    autoSubmitted: false,
    simulationPoints: null,
    baselinePassed: null,
    speedPoints: null,
    judgementId: null,
    design: null,
    total: null,
    place: null,
  });
  const hldMatches = {
    create: (
      users: string[],
      v: { family: string; battleMode: "human" | "ai"; seed: number },
    ) => {
      const id = `m${String(matches.size + 1)}`;
      matches.set(id, {
        match: {
          id,
          ...v,
          unrated: true,
          windowAt: null,
          startedAt: new Date(),
          deadlineAt: new Date("2030-01-01T00:00:00Z"), // still being played
          closedAt: null,
          scoredAt: null,
          rubricIncluded: null,
          ratedAt: null,
        },
        seats: users.map(seat),
      });
      return Promise.resolve(id);
    },
    get: (id: string) => Promise.resolve(matches.get(id) ?? null),
    retired: () => Promise.resolve(new Set<string>()),
  } as unknown as HldMatches; // only what the tournament flow calls
  const tournaments: HldTournaments = {
    create: () => Promise.resolve("t1"),
    list: () => Promise.resolve([tournament]),
    get: () => Promise.resolve(tournament),
    rounds: () =>
      Promise.resolve(
        Array.from({ length: 8 }, (_, i) => ({
          round: i + 1,
          family: "chat",
          seed: 3,
        })),
      ),
    register: () => Promise.resolve(true),
    unregister: () => Promise.resolve(),
    checkIn: () => Promise.resolve("checked_in"),
    entries: () => Promise.resolve(entries),
    pairings: () => Promise.resolve(pairings),
    claimRound: (_id, from, to, list) => {
      if (tournament.round !== from) return Promise.resolve(false);
      tournament = { ...tournament, round: to };
      pairings.push(...list.map((p) => ({ ...p })));
      return Promise.resolve(true);
    },
    setMatch: (_id, round, slot, matchId) => {
      const p = pairings.find((x) => x.round === round && x.slot === slot);
      if (p === undefined || p.matchId !== null) return Promise.resolve(false);
      p.matchId = matchId;
      return Promise.resolve(true);
    },
    roundOf: () => Promise.resolve(null),
    finish: (_id, at) => {
      tournament = { ...tournament, finishedAt: at };
      return Promise.resolve(true);
    },
  };
  const deps: TournamentDeps = {
    matches: hldMatches,
    judgements: {} as TournamentDeps["judgements"], // never reached: matches are scored here
    queue: { enqueue: vi.fn() },
    now: () => new Date("2026-11-20T18:00:00Z"),
    random: () => 0,
    tournaments,
  };
  // The better player wins every match: a beats b beats c…
  const strength = new Map(players.map((p, i) => [p, players.length - i]));
  const playRound = () => {
    for (const { match, seats } of matches.values()) {
      if (match.scoredAt !== null) continue;
      const [x, y] = [...seats].sort(
        (a, b) => (strength.get(b.userId) ?? 0) - (strength.get(a.userId) ?? 0),
      );
      Object.assign(x ?? {}, { place: 1, total: 80, simulationPoints: 50 });
      Object.assign(y ?? {}, { place: 2, total: 50, simulationPoints: 30 });
      match.scoredAt = new Date();
    }
  };
  // Every match ends with nothing served: no contest.
  const noShows = () => {
    for (const { match, seats } of matches.values()) {
      if (match.scoredAt !== null) continue;
      for (const s of seats)
        Object.assign(s, { place: 1, total: 0, simulationPoints: 0 });
      match.scoredAt = new Date();
    }
  };
  return { deps, pairings, playRound, noShows, matches, get: () => tournament };
}

describe("a tournament", () => {
  test("5 Swiss rounds, then the top 4's bracket, then finished", async () => {
    const w = world(["a", "b", "c", "d", "e"], { a: "U1", b: "U1", c: "U2" });
    expect(await nextRound(w.deps, "t1")).toBe("started");
    const first = w.pairings.filter((p) => p.round === 1);
    expect(first.map((p) => [p.playerA, p.playerB])).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e", null], // the bye
    ]);
    expect(await nextRound(w.deps, "t1")).toBe("waiting"); // not scored yet
    for (let round = 1; round <= 5; round++) {
      w.playRound();
      expect(await nextRound(w.deps, "t1")).toBe("started");
    }
    // After 5 rounds, 5 players: a bracket of 4 starts at the semi-finals.
    expect(w.get().round).toBe(7);
    const semis = w.pairings.filter((p) => p.round === 7);
    const view = await viewTournament(w.deps, "t1");
    const seeds = view?.standings.map((s) => s.userId) ?? [];
    expect(semis.map((p) => [p.playerA, p.playerB])).toEqual([
      [seeds[0], seeds[3]],
      [seeds[1], seeds[2]],
    ]);
    expect(seeds[0]).toBe("a");
    w.playRound();
    expect(await nextRound(w.deps, "t1")).toBe("started");
    const final = w.pairings.filter((p) => p.round === 8);
    expect(final).toHaveLength(1);
    w.playRound();
    expect(await nextRound(w.deps, "t1")).toBe("finished");
    expect(w.get().finishedAt).not.toBeNull();
    const done = await viewTournament(w.deps, "t1");
    expect(done?.pairings.find((p) => p.round === 8)?.winner).toBe("a");
    // §6.4: each university's top 5 members' Swiss points.
    expect(done?.universities.map((u) => u.university)).toEqual(["U1", "U2"]);
  });

  test("nobody rematches in Swiss while someone fresh is left, and byes don't repeat", async () => {
    const w = world(["a", "b", "c", "d", "e", "f", "g"], {});
    for (let round = 1; round <= 5; round++) {
      expect(await nextRound(w.deps, "t1")).toBe("started");
      w.playRound();
    }
    const swiss = w.pairings.filter((p) => p.round <= 5);
    const byes = swiss.filter((p) => p.playerB === null).map((p) => p.playerA);
    expect(new Set(byes).size).toBe(byes.length);
    const met = swiss
      .filter((p) => p.playerB !== null)
      .map((p) => [p.playerA, p.playerB ?? ""].sort().join("-"));
    expect(new Set(met).size).toBe(met.length);
  });

  test("a round whose matches weren't all made is finished on the next press, not skipped", async () => {
    const w = world(["a", "b", "c", "d"], {});
    const create = w.deps.matches.create.bind(w.deps.matches);
    let calls = 0;
    w.deps.matches.create = (...args) => {
      calls += 1;
      return calls === 2
        ? Promise.reject(new Error("db down"))
        : create(...args);
    };
    await expect(nextRound(w.deps, "t1")).rejects.toThrow("db down");
    expect(w.get().round).toBe(1);
    expect(w.pairings.filter((p) => p.matchId === null)).toHaveLength(1);
    expect(await nextRound(w.deps, "t1")).toBe("started");
    expect(w.get().round).toBe(1); // the same round, now complete
    expect(w.pairings.every((p) => p.matchId !== null)).toBe(true);
  });

  test("two designs that served nothing earn neither player a point", async () => {
    const w = world(["a", "b"], {});
    await nextRound(w.deps, "t1");
    w.noShows();
    const view = await viewTournament(w.deps, "t1");
    expect(view?.standings.map((s) => s.points)).toEqual([0, 0]);
  });

  test("fewer than 2 checked in can't start", async () => {
    const w = world(["a"], {});
    expect(await nextRound(w.deps, "t1")).toBe("too_few");
  });
});
