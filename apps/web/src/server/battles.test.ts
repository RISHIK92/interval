import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Expected, GENERATORS, Problem } from "@interval/lld";
import { expect, test } from "vitest";
import { groupWindow, startBattle } from "./battles";
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

async function loaded() {
  const rows = new Map<string, LoadedProblem>();
  const objects = new Map<string, string>();
  const store: ProblemStore = {
    pool: (league) =>
      Promise.resolve(
        [...rows.values()]
          .filter((r) => r.league === league)
          .map((r) => r.slug),
      ),
    hashes: () =>
      Promise.resolve(new Map([...rows].map(([s, r]) => [s, r.contentHash]))),
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
  await loadProblems([source], { store, files });
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
  }[] = [];
  const matches = {
    createBattle: (
      serverId: number,
      players: string[],
      slug: string,
      options?: { unrated: boolean },
    ) => {
      made.push({
        serverId,
        players,
        slug,
        ...(options === undefined ? {} : { unrated: options.unrated }),
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
    claim: async (_at, _league, _now, pick) => ({
      first: true,
      problem: await pick(),
      players: ["p1", "p2", "p3", "p4", "p5"].map((userId, i) => ({
        userId,
        rating: 30 - i,
      })),
    }),
    assign: (_at, _league, matchId, users) => {
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
