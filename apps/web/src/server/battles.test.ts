import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Expected, GENERATORS, Problem } from "@interval/lld";
import { expect, test } from "vitest";
import {
  battleModeOf,
  groupWindow,
  startBattle,
  startPracticeSession,
} from "./battles";
import { memoryRateLimits } from "./adapters/valkey-rate-limits";
import { memoryPracticeSessions } from "./adapters/valkey-practice-sessions";
import type {
  BattleMatch,
  BattleWindows,
  FileStore,
  LoadedProblem,
  MatchHandoff,
  ProblemStore,
} from "./ports";
import { loadProblems, type ProblemSource } from "./problems";

// P5-W31-S02b (§6.5, Q-P5-15; LLDQ-4): a battle's definition for the game server, built
// from a loaded problem and its private file: harnesses per language for the base and
// the extended interface, and every scenario with its expected results.
const fixture = join(
  import.meta.dirname,
  "../../../../packages/lld/fixtures/problems/inventory",
);
const read = (name: string) => readFileSync(join(fixture, name), "utf8");
const source: ProblemSource = {
  problem: Problem.parse(JSON.parse(read("problem.json"))),
  statement: read("statement.md"),
  extensionStatement: read("extension.md"),
  expected: Expected.parse(JSON.parse(read("expected.json"))),
};

// ADR-0048: the same problem in the practice pool, under its own slug.
const practiceSource: ProblemSource = {
  ...source,
  problem: {
    ...source.problem,
    slug: "inventory-practice",
    pool: "practice",
    topic: "systems",
    concepts: [],
  },
};

async function loaded() {
  const rows = new Map<string, LoadedProblem>();
  const objects = new Map<string, string>();
  const store: ProblemStore = {
    pool: (battleMode) =>
      Promise.resolve(
        [...rows.values()]
          .filter((r) => r.battleMode === battleMode && r.pool === "battle")
          .map((r) => r.slug),
      ),
    hashes: () =>
      Promise.resolve(new Map([...rows].map(([s, r]) => [s, r.contentHash]))),
    practice: () => Promise.resolve([]),
    get: (slug) => Promise.resolve(rows.get(slug) ?? null),
    save: (p) => {
      rows.set(p.slug, p);
      return Promise.resolve();
    },
    retire: () => Promise.resolve(),
  };
  const files: FileStore = {
    put: (key, bytes) => {
      objects.set(key, new TextDecoder().decode(bytes));
      return Promise.resolve();
    },
    get: (key) => {
      const text = objects.get(key);
      if (text === undefined) return Promise.resolve(null);
      return Promise.resolve({
        body: new Response(text).body ?? new ReadableStream(),
        etag: null,
        size: text.length,
      });
    },
    remove: () => Promise.resolve(),
  };
  await loadProblems([source, practiceSource], { store, files });
  const handed: BattleMatch[] = [];
  const handoff: MatchHandoff = {
    put: () => Promise.reject(new Error("not a quiz")),
    putBattle: (m) => {
      handed.push(m);
      return Promise.resolve();
    },
  };
  const made: {
    serverId: number;
    players: string[];
    slug: string;
    unrated?: boolean;
    practice?: boolean;
  }[] = [];
  const matches = {
    createBattle: (
      serverId: number,
      players: string[],
      slug: string,
      options?: { unrated?: boolean; practice?: boolean },
    ) => {
      made.push({
        serverId,
        players,
        slug,
        ...(options?.unrated === undefined ? {} : { unrated: options.unrated }),
        ...(options?.practice === undefined
          ? {}
          : { practice: options.practice }),
      });
      return Promise.resolve(`match-${String(made.length)}`);
    },
  };
  return { store, files, matches, handoff, handed, made };
}

test("a battle carries every language's harnesses and every scenario with its results", async () => {
  const deps = await loaded();
  const id = await startBattle(deps, 0, "inventory", ["ana", "bo"]);
  const [match] = deps.handed;
  if (match === undefined) throw new Error("nothing handed over");
  // The match row names the problem; the handoff carries its id.
  expect(deps.made).toEqual([
    { serverId: 0, players: ["ana", "bo"], slug: "inventory" },
  ]);
  expect(match.id).toBe(id);
  expect(match.players).toEqual(["ana", "bo"]);
  const b = match.battle;
  expect(b.problem).toBe("inventory");
  expect(b.limits).toEqual(source.problem.limits);
  expect(Object.keys(b.languages).sort()).toEqual(
    Object.keys(GENERATORS).sort(),
  );
  // The base harness can't call an extension method; the extended one can.
  const python = b.languages["python"];
  expect(python?.solution).toBe("solution.py");
  expect(python?.base[0]?.content).not.toContain('"reserve"');
  expect(python?.extension[0]?.content).toContain('"reserve"');
  // Every scenario, in order, with the reference's results.
  expect(b.scenarios.map((s) => s.layer)).toEqual(
    source.expected.map((e) => e.layer),
  );
  expect(b.scenarios.map((s) => s.expected)).toEqual(
    source.expected.map((e) => e.results),
  );
  expect(JSON.parse(b.scenarios[0]?.stdin ?? "")).toEqual(
    source.problem.layers.visible[0],
  );
  // The extension's text, for the game server to show at the reveal.
  expect(b.extension?.statement).toBe(source.extensionStatement);
  expect(b.extension?.starters["python"]).toContain("def reserve(");
});

// §6.6: a casual player nobody matched plays on alone, so one player is a battle too.
test("no battle on a problem that isn't loaded, or without distinct players", async () => {
  const deps = await loaded();
  await expect(startBattle(deps, 0, "nope", ["ana", "bo"])).rejects.toThrow(
    /no such problem/,
  );
  await expect(startBattle(deps, 0, "inventory", [])).rejects.toThrow(
    /players/,
  );
  await expect(
    startBattle(deps, 0, "inventory", ["ana", "ana"]),
  ).rejects.toThrow(/players/);
  expect(deps.handed).toEqual([]);
  expect(deps.made).toEqual([]);
  // C-03 (P5-W32): rooms of up to 4.
  await expect(
    startBattle(deps, 0, "inventory", ["a", "b", "c", "d", "e"]),
  ).rejects.toThrow(/players/);
  await startBattle(deps, 0, "inventory", ["ana"], { unrated: true });
  expect(deps.handed).toHaveLength(1);
  expect(deps.made[0]?.unrated).toBe(true);
});

// P5-W32 (Q-P5-19): a window's registrants into rooms of 4, then 3 or 2, one alone
// and unranked; all on the window's problem; a failed group stays for the next poll.
test("a window groups its registrants by rating on one problem", async () => {
  const deps = await loaded();
  const assigned: { matchId: string; users: string[] }[] = [];
  const windows: BattleWindows = {
    register: () => Promise.resolve(),
    unregister: () => Promise.resolve(),
    registration: () => Promise.resolve(null),
    extend: () => Promise.resolve(),
    claim: async (_at, _battleMode, _now, pick) => ({
      first: true,
      problem: await pick(),
      players: ["p1", "p2", "p3", "p4", "p5"].map((userId, i) => ({
        userId,
        rating: 30 - i,
      })),
    }),
    assign: (_at, _battleMode, matchId, users) => {
      assigned.push({ matchId, users });
      return Promise.resolve();
    },
  };
  const at = new Date("2026-11-13T15:30:00Z");
  expect(
    await groupWindow({ ...deps, windows }, at, "human", () => at),
  ).toEqual({
    grouped: 5,
    matched: 4,
    first: true,
  });
  expect(assigned.map((a) => a.users)).toEqual([
    ["p1", "p2", "p3", "p4"],
    ["p5"],
  ]);
  expect(deps.made.map((m) => [m.slug, m.unrated])).toEqual([
    ["inventory", false],
    ["inventory", true],
  ]);
  // Another poll's claim: nothing made again.
  const taken = { ...windows, claim: () => Promise.resolve(null) };
  expect(
    await groupWindow({ ...deps, windows: taken }, at, "human", () => at),
  ).toBeNull();
});

test("a battle that can't be handed over is thrown, not lost quietly", async () => {
  const deps = await loaded();
  const failing = {
    ...deps,
    handoff: {
      put: () => Promise.reject(new Error("not a quiz")),
      putBattle: () => Promise.reject(new Error("valkey down")),
    },
  };
  await expect(startBattle(failing, 0, "inventory", ["ana"])).rejects.toThrow(
    /valkey down/,
  );
});

// ADR-0047 (Q-P5-20): ?mode= names the battle mode; a link from before the rename says
// ?league=, read as ?mode= when that is absent.
test("a request's battle mode: ?mode=, then an old ?league=, else human", () => {
  const of = (query: string) =>
    battleModeOf(new Request(`http://localhost/api/battle/queue${query}`));
  expect(of("?mode=ai")).toBe("ai");
  expect(of("?mode=human&league=ai")).toBe("human");
  expect(of("?league=ai")).toBe("ai");
  expect(of("")).toBe("human");
  expect(of("?mode=quick")).toBeNull();
});

// ADR-0047 (Q-P5-20): the handoff names the battle mode as battle_mode, the game server's
// key (services/game/battle.go); human unless the battle says otherwise.
test("a battle hands over its battle mode", async () => {
  const deps = await loaded();
  await startBattle(deps, 0, "inventory", ["ana", "bo"], { battleMode: "ai" });
  await startBattle(deps, 0, "inventory", ["ana", "bo"]);
  expect(deps.handed.map((m) => m.battle.battle_mode)).toEqual(["ai", "human"]);
});

// ADR-0048 (Q-WD-28): a practice problem is never a battle's.
test("a battle refuses a practice problem", async () => {
  const deps = await loaded();
  await expect(
    startBattle(deps, 0, "inventory-practice", ["ana"]),
  ).rejects.toThrow(/practice/);
  expect(deps.made).toEqual([]);
});

// ADR-0048 (Q-WD-28): a practice session is the battle's handoff with practice set, for
// one player, unrated; an open one on the same problem is gone back to, until it ends.
test("a practice session hands over a practice battle and is reused while open", async () => {
  const deps = {
    ...(await loaded()),
    sessions: memoryPracticeSessions(),
    limits: memoryRateLimits(),
  };
  expect(await startPracticeSession(deps, "ana", "inventory", null)).toEqual({
    status: "not-practice",
  });
  expect(await startPracticeSession(deps, "ana", "nope", null)).toEqual({
    status: "not-practice",
  });
  const first = await startPracticeSession(
    deps,
    "ana",
    "inventory-practice",
    null,
  );
  expect(first).toEqual({
    status: "started",
    matchId: "match-1",
    problem: expect.objectContaining({ difficulty: "easy" }) as unknown,
  });
  expect(deps.made).toEqual([
    {
      serverId: 0,
      players: ["ana"],
      slug: "inventory-practice",
      unrated: true,
      practice: true,
    },
  ]);
  const [match] = deps.handed;
  expect(match?.players).toEqual(["ana"]);
  expect(match?.battle.practice).toBe(true);
  expect(match?.battle.battle_mode).toBe("human");
  expect(match?.battle.extension?.statement).toBe(source.extensionStatement);
  // A reload goes back to it; once it has ended, a new one.
  expect(
    await startPracticeSession(deps, "ana", "inventory-practice", null),
  ).toEqual({ status: "open", matchId: "match-1" });
  expect(
    await startPracticeSession(deps, "ana", "inventory-practice", "match-1"),
  ).toMatchObject({ status: "started", matchId: "match-2" });
  expect(deps.handed).toHaveLength(2);
});

test("starting practice sessions is rate-limited", async () => {
  const deps = {
    ...(await loaded()),
    sessions: memoryPracticeSessions(),
    limits: memoryRateLimits(),
  };
  let ended: string | null = null;
  for (let i = 0; i < 20; i += 1) {
    const started = await startPracticeSession(
      deps,
      "ana",
      "inventory-practice",
      ended,
    );
    if (started.status !== "started") throw new Error(started.status);
    ended = started.matchId;
  }
  expect(
    await startPracticeSession(deps, "ana", "inventory-practice", ended),
  ).toEqual({ status: "limited" });
  expect(deps.made).toHaveLength(20);
});
