import { describe, expect, test } from "vitest";
import { coverage } from "./coverage";
import type { Design } from "./design";
import { updateNode } from "./edit";
import { CUPS, FAMILIES } from "./families";
import { variant } from "./family";
import { CLIPS, QUEUED, SIGN_IN, STUDIO } from "./fixtures.test-helpers";
import { HldProblem } from "./problem";
import { simulate } from "./simulate";

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
    spec: "1.0",
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
    spec: "1.0",
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

// ADR-0050 [lag]: "fast" on asynchronous work holds it to its completion target, not
// the caller's p99.
test("asynchronous work is fast when it's done within its target", () => {
  const problem = HldProblem.parse({
    ...SIGN_IN,
    requirements: ["Send a code within 15 minutes."],
    covers: [
      {
        rule: "request",
        request: "send_code",
        through: ["external_api"],
        fast: true,
      },
    ],
  });
  expect(run(problem, QUEUED).items[0]?.by).toBe(
    "External provider; done within a second",
  );
  const slow = HldProblem.parse({
    ...problem,
    traffic: {
      ...problem.traffic,
      requests: problem.traffic.requests.map((r) =>
        r.type === "send_code" ? { ...r, completionSeconds: 0.01 } : r,
      ),
    },
  });
  expect(run(slow, QUEUED).items[0]?.covered).toBe(false);
});

// [lag]: work that never catches up (lagSeconds null) is never fast.
test("asynchronous work whose backlog never drains isn't covered", () => {
  const problem = HldProblem.parse({
    ...CLIPS,
    requirements: ["Transcode an upload within 30 minutes."],
    covers: [
      { rule: "request", request: "upload", through: ["worker"], fast: true },
    ],
  });
  const starved = updateNode(STUDIO, "transcoders", { config: { nodes: 20 } });
  expect(run(problem, starved).items[0]?.covered).toBe(false);
  expect(run(problem, STUDIO).items[0]?.covered).toBe(true);
});

// Spec 2.1's kinds in words: a geo index by its shards, a coordinator by its members.
test("2.1's kinds say what sizes them", () => {
  const family = (slug: string) => {
    const f = FAMILIES.find((x) => x.slug === slug);
    if (f === undefined) throw new Error(`no ${slug}`);
    return variant(f, "human", 1);
  };
  const ids = family("id-generator");
  expect(run(ids.problem, ids.reference).items[1]?.by).toBe(
    "Coordination service, 3 members",
  );
  const nearby = family("nearby-places");
  expect(run(nearby.problem, nearby.reference).items[0]?.by).toMatch(
    /^Geo index, \d+ shards; p99 \d+ ms$/,
  );
  const flags = family("feature-flags");
  expect(run(flags.problem, flags.reference).items[1]?.by).toMatch(
    /^Connection gateway, \d+ nodes; done within \d+ seconds$/,
  );
});

// ADR-0053 (owner, 2026-11-24): card fees are paid apart from the budget, so neither
// uncovers the other, nor the scenarios: a processor over its fee target leaves the
// budget and every scenario covered, and an infrastructure over budget leaves the fees.
describe("card fees and the budget cover apart", () => {
  const family = FAMILIES.find((f) => f.slug === "payment-processing");
  if (family === undefined) throw new Error("no payment-processing");
  const v = variant(family, "human", 1);
  const by = (design: Design, problem = v.problem) => {
    const c = run(problem, design);
    const at = (rule: string) =>
      c.items[(problem.covers ?? []).findIndex((x) => x.rule === rule)]
        ?.covered;
    return {
      budget: at("budget"),
      fees: at("fees"),
      scenarios: (problem.covers ?? []).every(
        (x, i) => x.rule !== "scenario" || c.items[i]?.covered === true,
      ),
    };
  };

  test("PayPal over its fee target: the budget and the scenarios stay covered", () => {
    const flaw = v.flawed.find((f) => f.id === "paypal-fees");
    if (flaw === undefined) throw new Error("no paypal-fees");
    expect(by(flaw.design)).toEqual({
      budget: true,
      fees: false,
      scenarios: true,
    });
  });

  test("Stripe on a design over budget: the fees stay covered", () => {
    const tight = { ...v.problem, budgetPerMonth: 100 };
    expect(by(v.reference, tight)).toEqual({
      budget: false,
      fees: true,
      scenarios: false,
    });
  });
});
