import type { ComponentKind } from "./catalog";
import { CONFIG } from "./catalog";
import type { Design, DesignEdge, DesignNode } from "./design";
import { removeNode } from "./edit";
import { HldProblem, type Scenario } from "./problem";
import { simulate } from "./simulate";
import { CURRENT_SPEC } from "./spec";

// P6-W40 (HLDQ-2, HLDQ-3; Q-P6-04): problem families. A family is a template: its
// requests, the ranges its numbers are drawn from per league, and the shape of a design
// that solves it. A variant is (family, league, seed); the seed decides every number,
// so the same seed always rebuilds the same problem (replays, disputes).
//
// Every variant is validated before it can be played: its reference design (the
// family's shape, sized by simulation for that variant's numbers) passes every
// scenario, and each flawed design (the reference with one weakness) fails exactly the
// scenario it targets. Only seeds that pass go into the pool (pool.json).

export type League = "human" | "ai";
type Span = readonly [number, number];

export type Family = {
  slug: string;
  title: string;
  requirements: string[];
  concepts: string[];
  rubric: HldProblem["rubric"];
  allowedComponents: ComponentKind[];
  // Each request type's share of the traffic.
  requests: {
    type: string;
    kind: "read" | "write";
    cacheable: boolean;
    share: number;
  }[];
  ranges: Record<
    League,
    {
      rps: Span; // all request types together, at baseline
      workingSetGb: Span;
      hotKeySkew: Span;
      storedGb: Span;
      growthGbPerDay: Span;
      p99Ms: Span; // the baseline's target
    }
  >;
  horizonDays: number;
  // The reference design's shape: its nodes at their smallest, and its edges. The
  // sizer sets zones, regions, counts, memory and storage.
  shape: { nodes: DesignNode[]; edges: DesignEdge[] };
  practiceSeeds: readonly number[];
  // The family's own lesson as a flaw, where the simulator can show it: the reference
  // without what the lesson is about, and the one scenario that must then fail. Where
  // it can't (an asynchronous write path costs nothing the simulator measures), the
  // rubric carries the lesson instead.
  lesson?: { id: string; targets: string; without: string };
};

// mulberry32: small, fast and the same on every platform; seeds are 32-bit.
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// One stream per family and league, so a seed means something different in each.
function streamFor(family: string, league: League, seed: number) {
  let h = 2166136261;
  for (const c of `${family}/${league}/${String(seed)}`)
    h = Math.imul(h ^ (c.codePointAt(0) ?? 0), 16777619);
  return random(h);
}
// Rounded to its step and then to 2 decimals, so 0.05 steps never show as
// 0.7000000000000001.
const draw = (next: () => number, [lo, hi]: Span, step: number) =>
  Number((Math.round((lo + next() * (hi - lo)) / step) * step).toFixed(2));

const fmt = (x: number) => Math.round(x).toLocaleString("en-US");

// The scenarios every variant runs: a normal day, a spike, a zone's loss; the AI league
// also loses a region (Q-P6-04). Targets loosen as the scenario gets harder.
function scenarios(league: League, p99Ms: number): Scenario[] {
  const list: Scenario[] = [
    {
      id: "baseline",
      name: "A normal day",
      weight: 3,
      load: 1,
      targets: { p99Ms, availability: 0.999 },
    },
    {
      id: "peak",
      name: "A spike: three times the traffic",
      weight: 2,
      load: 3,
      targets: { p99Ms: p99Ms * 2, availability: 0.995 },
    },
    {
      id: "zone",
      name: "A zone goes down",
      weight: 2,
      load: 1,
      failure: { scope: "zone" },
      targets: { p99Ms: Math.round(p99Ms * 1.5), availability: 0.99 },
    },
  ];
  if (league === "ai")
    list.push({
      id: "region",
      name: "A region goes down",
      weight: 2,
      load: 1,
      failure: { scope: "region" },
      targets: { p99Ms: p99Ms * 2, availability: 0.99 },
    });
  return list;
}

// The problem a seed makes, before its budget is known (the sizer finds the cost).
function draft(family: Family, league: League, seed: number, budget: number) {
  const next = streamFor(family.slug, league, seed);
  const r = family.ranges[league];
  const rps = draw(next, r.rps, 100);
  const traffic = {
    requests: family.requests.map(({ share, ...t }) => ({
      ...t,
      rps: Math.max(1, Math.round(rps * share)),
    })),
    workingSetGb: draw(next, r.workingSetGb, 1),
    hotKeySkew: draw(next, r.hotKeySkew, 0.05),
    storedGb: draw(next, r.storedGb, 10),
    growthGbPerDay: draw(next, r.growthGbPerDay, 0.5),
    horizonDays: family.horizonDays,
  };
  const p99Ms = draw(next, r.p99Ms, 5);
  const needed =
    traffic.storedGb + traffic.growthGbPerDay * traffic.horizonDays;
  return HldProblem.parse({
    slug: `${family.slug}-${league}-${String(seed)}`,
    title: family.title,
    league,
    timeLimitMinutes: 30,
    requirements: [
      ...family.requirements,
      `About ${traffic.requests.map((t) => `${fmt(t.rps)} ${t.type.replaceAll("_", " ")}`).join(", ")} requests a second on a normal day.`,
      `${fmt(traffic.storedGb)} GB kept today, growing ${String(traffic.growthGbPerDay)} GB a day: ${fmt(needed)} GB within ${String(traffic.horizonDays)} days.`,
      `A budget of $${fmt(budget)} a month.`,
    ],
    traffic,
    budgetPerMonth: budget,
    scenarios: scenarios(league, p99Ms),
    allowedComponents: family.allowedComponents,
    rubric: family.rubric,
    concepts: family.concepts,
  });
}

// The field that adds capacity to each kind, and what it may reach.
const COUNT: Partial<Record<ComponentKind, string>> = {
  app_service: "nodes",
  worker: "nodes",
  cache: "nodes",
  kv_store: "nodes",
  queue: "partitions",
  stream: "partitions",
  sql_db: "readReplicas",
  search_index: "replicas",
};
// Compute whose loss a spike shows first; caches and stores keep their memory and
// storage, so a flaw in them would fail every scenario, not one.
const COMPUTE = new Set<ComponentKind>([
  "app_service",
  "worker",
  "queue",
  "stream",
]);

const maxOf = (kind: ComponentKind, field: string) => {
  const shape = CONFIG[kind].shape as Record<
    string,
    { maxValue?: number | null }
  >;
  return shape[field]?.maxValue ?? 1;
};
type Config = Record<string, number | string>;
const withConfig = (n: DesignNode, change: Config): DesignNode =>
  ({ ...n, config: { ...n.config, ...change } }) as DesignNode;
const configOf = (n: DesignNode) => n.config as Config;

function scaleCounts(
  design: Design,
  factor: number,
  kinds: Set<ComponentKind>,
): Design {
  return {
    ...design,
    nodes: design.nodes.map((n) => {
      const field = COUNT[n.kind];
      if (field === undefined || !kinds.has(n.kind)) return n;
      const zones = Number(configOf(n)["zones"] ?? 1);
      const floor =
        n.kind === "sql_db" || n.kind === "search_index" ? 0 : zones;
      const value = Math.ceil(Number(configOf(n)[field]) * factor);
      return withConfig(n, {
        [field]: Math.min(maxOf(n.kind, field), Math.max(floor, value)),
      });
    }),
  };
}

// The reference's compute cut to run at `utilization` in one scenario: enough for every
// gentler one, too little for that one.
function sizedFor(
  reference: Design,
  problem: HldProblem,
  scenario: string,
  utilization: number,
): Design {
  const nodes = simulate(problem, reference).scenarios.find(
    (s) => s.id === scenario,
  )?.nodes;
  return {
    ...reference,
    nodes: reference.nodes.map((n) => {
      const field = COUNT[n.kind];
      const used = nodes?.find((x) => x.id === n.id)?.utilization ?? 0;
      if (field === undefined || !COMPUTE.has(n.kind) || used === 0) return n;
      const count = Number(configOf(n)[field]);
      const floor = Number(configOf(n)["zones"] ?? 1);
      const cut = Math.max(floor, Math.floor((count * used) / utilization));
      return withConfig(n, { [field]: Math.min(count, cut) });
    }),
  };
}

// The utilization the sizer keeps every component under, in every scenario.
const HEADROOM = 0.6;

// The family's shape sized for a problem: three zones, a second region in the AI
// league, a standby in another zone, storage for the horizon with room to spare; then
// simulated, and whatever runs above HEADROOM grown, until nothing does.
function size(family: Family, problem: HldProblem): Design {
  const t = problem.traffic;
  const needed = t.storedGb + t.growthGbPerDay * t.horizonDays;
  const regions = problem.league === "ai" ? 2 : 1;
  let design: Design = {
    version: 1,
    spec: CURRENT_SPEC.version,
    nodes: family.shape.nodes.map((n) => {
      const c = configOf(n);
      const change: Config = {};
      if ("zones" in c) change["zones"] = 3;
      if ("regions" in c) change["regions"] = regions;
      const field = COUNT[n.kind];
      if (
        field !== undefined &&
        n.kind !== "sql_db" &&
        n.kind !== "search_index"
      )
        change[field] = Math.max(3, Number(c[field]));
      if (n.kind === "sql_db") {
        change["failover"] = "multi_zone";
        change["storageGb"] = Math.min(
          16_000,
          Math.max(10, Math.ceil(needed * 1.3)),
        );
      }
      if (n.kind === "kv_store") {
        change["replication"] = 3;
        change["nodes"] = Math.max(
          3,
          Math.ceil((needed * 2) / CURRENT_SPEC.engine.kvStorageGbPerNode),
        );
      }
      return withConfig(n, change);
    }),
    edges: family.shape.edges,
  };
  const memory = (d: Design): Design => ({
    ...d,
    nodes: d.nodes.map((n) =>
      n.kind === "cache"
        ? withConfig(n, {
            memoryGbPerNode: Math.min(
              256,
              Math.ceil((t.workingSetGb * 1.2) / n.config.nodes),
            ),
          })
        : n,
    ),
  });
  design = memory(design);
  for (let round = 0; round < 40; round++) {
    const result = simulate(problem, design);
    const hot = new Set<string>();
    for (const s of result.scenarios)
      for (const n of s.nodes)
        if (n.up && (n.utilization === null || n.utilization > HEADROOM))
          hot.add(n.id);
    const growable = design.nodes.filter((n) => {
      const field = COUNT[n.kind];
      return (
        hot.has(n.id) &&
        field !== undefined &&
        Number(configOf(n)[field]) < maxOf(n.kind, field)
      );
    });
    if (growable.length === 0) break;
    design = memory({
      ...design,
      nodes: design.nodes.map((n) => {
        const field = COUNT[n.kind];
        if (field === undefined || !growable.includes(n)) return n;
        const value = Number(configOf(n)[field]);
        return withConfig(n, {
          [field]: Math.min(
            maxOf(n.kind, field),
            Math.max(value + 1, Math.ceil(value * 1.4)),
          ),
        });
      }),
    });
  }
  return design;
}

// The flawed-design catalog (HLDQ-3): the reference with one weakness each, and the one
// scenario that weakness must fail.
function flaws(
  family: Family,
  reference: Design,
  problem: HldProblem,
): { id: string; targets: string; design: Design }[] {
  const lesson = family.lesson;
  const list = [
    ...(lesson === undefined
      ? []
      : [
          {
            id: lesson.id,
            targets: lesson.targets,
            design: removeNode(reference, lesson.without),
          },
        ]),
    // With a second active region, one zone's loss is survivable in any case, so the
    // AI league's zone flaw is the one-region design below.
    ...(problem.league === "ai"
      ? []
      : [
          {
            id: "single-zone",
            targets: "zone",
            design: {
              ...reference,
              nodes: reference.nodes.map((n) => {
                const c = configOf(n);
                const change: Config = {};
                if ("zones" in c) change["zones"] = 1;
                if (n.kind === "sql_db") change["failover"] = "standby";
                return withConfig(n, change);
              }),
            },
          },
        ]),
    {
      id: "no-spike-headroom",
      targets: "peak",
      design: sizedFor(reference, problem, "peak", 1.15),
    },
  ];
  if (problem.league === "ai")
    list.push({
      id: "one-region",
      targets: "region",
      // The same capacity, all in one region.
      design: scaleCounts(
        {
          ...reference,
          nodes: reference.nodes.map((n) =>
            "regions" in configOf(n) ? withConfig(n, { regions: 1 }) : n,
          ),
        },
        2,
        new Set(Object.keys(COUNT) as ComponentKind[]),
      ),
    });
  return list;
}

type Variant = {
  problem: HldProblem;
  reference: Design;
  flawed: { id: string; targets: string; design: Design }[];
};

export function variant(family: Family, league: League, seed: number): Variant {
  const sizing = draft(family, league, seed, 1e9);
  const reference = size(family, sizing);
  const cost = simulate(sizing, reference).costPerMonth;
  const budget = Math.ceil((cost * (league === "ai" ? 1.2 : 1.5)) / 100) * 100;
  return {
    problem: draft(family, league, seed, budget),
    reference,
    flawed: flaws(family, reference, sizing),
  };
}

// HLDQ-3's check, in words: empty when the variant is valid.
export function validate(v: Variant): string[] {
  const problems: string[] = [];
  const reference = simulate(v.problem, v.reference);
  for (const s of reference.scenarios)
    if (!s.targetsMet) problems.push(`the reference design misses "${s.id}"`);
  for (const f of v.flawed) {
    const r = simulate(v.problem, f.design);
    const failed = r.scenarios.filter((s) => !s.targetsMet).map((s) => s.id);
    if (failed.length !== 1 || failed[0] !== f.targets)
      problems.push(
        `${f.id} should fail only "${f.targets}" but fails ${failed.length === 0 ? "nothing" : failed.map((x) => `"${x}"`).join(", ")}`,
      );
  }
  return problems;
}

export type Pool = Record<string, Record<League, number[]>>;
export const POOL_SIZE = 12;

// The playable seeds (HLDQ-3): the first POOL_SIZE valid ones per family and league,
// never a practice seed (Q-P6-04).
export function buildPool(families: readonly Family[]): Pool {
  const pool: Pool = {};
  for (const f of families) {
    const seeds = (league: League) => {
      const found: number[] = [];
      for (let seed = 1; found.length < POOL_SIZE && seed <= 500; seed++)
        if (
          !f.practiceSeeds.includes(seed) &&
          validate(variant(f, league, seed)).length === 0
        )
          found.push(seed);
      return found;
    };
    pool[f.slug] = { human: seeds("human"), ai: seeds("ai") };
  }
  return pool;
}
