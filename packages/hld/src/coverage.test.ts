import { describe, expect, test } from "vitest";
import { coverage } from "./coverage";
import type { Design } from "./design";
import { CUPS, FAMILIES } from "./families";
import { variant } from "./family";
import { HldProblem } from "./problem";
import { simulate } from "./simulate";
import { CURRENT_SPEC } from "./spec";

// Q-WD-15: requirement coverage by the problem's own rules.

const shortener = variant(FAMILIES[0] as (typeof FAMILIES)[number], "human", 3);
const run = (problem: HldProblem, design: Design) =>
  coverage(problem, design, simulate(problem, design));

describe.each([...FAMILIES, ...CUPS.map((c) => c.family)])(
  "$slug",
  (family) => {
    test("every requirement has a rule, and the reference design covers them all", () => {
      const { problem, reference } = variant(family, "human", 3);
      expect(problem.covers).toHaveLength(problem.requirements.length);
      const c = run(problem, reference);
      expect(c.items.filter((x) => !x.covered)).toEqual([]);
      expect(c.covered).toBe(c.total);
      for (const item of c.items) expect(item.by).toMatch(/\S/);
    });
  },
);

test("the URL shortener's reference: what covers each requirement, in words", () => {
  const c = run(shortener.problem, shortener.reference);
  expect(c.total).toBe(5);
  expect(c.items[0]?.by).toMatch(/^Relational database, \d+ read replicas?$/);
  expect(c.items[1]?.by).toMatch(
    /^Cache, \d+ nodes of \d+ GB; Relational database, \d+ read replicas?; p99 \d+ ms$/,
  );
  expect(c.items[2]?.by).toMatch(/^A normal day: p99 \d+ ms, [\d.]+% served$/);
  expect(c.items[3]?.by).toMatch(
    /^Room for [\d,]+ GB of the [\d,]+ GB needed$/,
  );
  expect(c.items[4]?.by).toMatch(/^\$[\d,]+ a month$/);
});

test("a naive design leaves what it doesn't build uncovered", () => {
  // Redirects straight to one small database; creating a link isn't routed at all.
  const naive: Design = {
    version: 1,
    spec: CURRENT_SPEC.version,
    nodes: [
      { id: "users", kind: "client", config: {}, note: "" },
      {
        id: "api",
        kind: "app_service",
        config: { nodes: 1, zones: 1, regions: 1 },
        note: "",
      },
      {
        id: "db",
        kind: "sql_db",
        config: {
          readReplicas: 0,
          storageGb: 10,
          failover: "none",
          regions: 1,
        },
        note: "",
      },
    ],
    edges: [
      { from: "users", to: "api", routes: ["redirect"] },
      { from: "api", to: "db", routes: ["redirect"] },
    ],
  };
  const c = run(shortener.problem, naive);
  const covered = Object.fromEntries(c.items.map((x) => [x.text, x.covered]));
  expect(covered[shortener.problem.requirements[0] ?? ""]).toBe(false); // create
  expect(c.items[0]?.by).toBeNull();
  expect(c.items[3]?.covered).toBe(false); // 10 GB holds nothing like the horizon
  expect(c.items[4]?.covered).toBe(false); // cheap, but it can't carry a normal day
  expect(c.covered).toBeLessThan(c.total);
});

test("an empty design covers nothing", () => {
  const empty: Design = {
    version: 1,
    spec: CURRENT_SPEC.version,
    nodes: [{ id: "users", kind: "client", config: {}, note: "" }],
    edges: [],
  };
  const c = run(shortener.problem, empty);
  expect(c.covered).toBe(0); // not even the budget: it carries nothing
  expect(c.items.every((x) => x.by === null)).toBe(true);
});

test("a problem without rules shows its requirements, none covered", () => {
  const c = run(
    HldProblem.parse({ ...shortener.problem, covers: undefined }),
    shortener.reference,
  );
  expect(c).toMatchObject({ covered: 0, total: 5 });
  expect(c.items.every((x) => x.by === null)).toBe(true);
});

test("a problem's rules must match its requirements, request types and scenarios", () => {
  const p = shortener.problem;
  expect(
    HldProblem.safeParse({ ...p, covers: p.covers?.slice(1) }).success,
  ).toBe(false);
  const wrong = (cover: unknown) =>
    HldProblem.safeParse({
      ...p,
      covers: [cover, ...(p.covers ?? []).slice(1)],
    }).success;
  expect(wrong({ rule: "request", request: "nope", through: ["cache"] })).toBe(
    false,
  );
  expect(wrong({ rule: "scenario", scenario: "nope" })).toBe(false);
  expect(wrong({ rule: "budget" })).toBe(true);
});

test("deterministic: the same inputs give the same coverage", () => {
  expect(run(shortener.problem, shortener.reference)).toEqual(
    run(shortener.problem, shortener.reference),
  );
});
