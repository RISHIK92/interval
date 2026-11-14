import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { FAMILIES } from "./families";
import { buildPool, POOL_SIZE, type Pool, validate, variant } from "./family";
import { practiceProblems } from "./practice";
import { simulate } from "./simulate";

// P6-W40 (HLDQ-2, HLDQ-3; Q-P6-04): the families, their variants and the pool.
const pool = JSON.parse(
  readFileSync(join(import.meta.dirname, "pool.json"), "utf8"),
) as Pool;

test("there are 8 families, each with its own slug", () => {
  expect(new Set(FAMILIES.map((f) => f.slug)).size).toBe(8);
});

// CANVAS-3's regression check for variants: an engine or family change that breaks one
// fails here; `pnpm --filter @interval/hld pool` rebuilds the file.
test("pool.json is what the families and the engine make now", () => {
  expect(buildPool(FAMILIES)).toEqual(pool);
});

describe.each(FAMILIES)("$slug", (family) => {
  test("each league has a full pool of valid seeds, none of them for practice", () => {
    for (const league of ["human", "ai"] as const) {
      const seeds = pool[family.slug]?.[league] ?? [];
      expect(seeds).toHaveLength(POOL_SIZE);
      for (const seed of seeds) {
        expect(family.practiceSeeds).not.toContain(seed);
        expect(validate(variant(family, league, seed))).toEqual([]);
      }
    }
  });

  test("its practice seed is valid too", () => {
    for (const seed of family.practiceSeeds)
      expect(validate(variant(family, "human", seed))).toEqual([]);
  });

  test("a seed always makes the same variant", () => {
    expect(variant(family, "ai", 7)).toEqual(variant(family, "ai", 7));
  });

  test("the AI league is harder: less budget headroom, a lost region, more traffic", () => {
    const rps = (p: { traffic: { requests: { rps: number }[] } }) =>
      p.traffic.requests.reduce((a, r) => a + r.rps, 0);
    const headroom = (league: "human" | "ai", seed: number) => {
      const v = variant(family, league, seed);
      return (
        v.problem.budgetPerMonth / simulate(v.problem, v.reference).costPerMonth
      );
    };
    for (const seed of [3, 4, 5]) {
      expect(headroom("ai", seed)).toBeLessThan(headroom("human", seed));
      const ai = variant(family, "ai", seed).problem;
      const human = variant(family, "human", seed).problem;
      expect(ai.scenarios.map((s) => s.id)).toContain("region");
      expect(human.scenarios.map((s) => s.id)).not.toContain("region");
    }
    const mean = (league: "human" | "ai") =>
      [3, 4, 5, 6, 7].reduce(
        (a, seed) => a + rps(variant(family, league, seed).problem),
        0,
      );
    expect(mean("ai")).toBeGreaterThan(mean("human"));
  });

  test("different seeds make different problems", () => {
    expect(variant(family, "human", 3).problem.traffic).not.toEqual(
      variant(family, "human", 4).problem.traffic,
    );
  });
});

test("practice is each family's practice seed, under the family's slug", () => {
  expect(practiceProblems().map((p) => p.slug)).toEqual(
    FAMILIES.map((f) => f.slug),
  );
  expect(practiceProblems()[0]?.requirements.at(-1)).toMatch(/^A budget of \$/);
});

// HLDQ-3's three ways a variant can be invalid, each caught.
describe("validate", () => {
  const family = FAMILIES[0];
  if (family === undefined) throw new Error("no families");
  const v = variant(family, "human", 3);
  const flawed = v.flawed[0];
  if (flawed === undefined) throw new Error("no flaws");
  const client = {
    ...v.reference,
    nodes: v.reference.nodes.slice(0, 1),
    edges: [],
  };

  test("a reference that misses a scenario", () => {
    expect(validate({ ...v, reference: client })).toContain(
      'the reference design misses "baseline"',
    );
  });

  test("a flaw that fails nothing, and one that fails more than its target", () => {
    expect(
      validate({ ...v, flawed: [{ ...flawed, design: v.reference }] }),
    ).toEqual([
      `${flawed.id} should fail only "${flawed.targets}" but fails nothing`,
    ]);
    expect(validate({ ...v, flawed: [{ ...flawed, design: client }] })).toEqual(
      [
        `${flawed.id} should fail only "${flawed.targets}" but fails "baseline", "peak", "zone"`,
      ],
    );
  });
});
