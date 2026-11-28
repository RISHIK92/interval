import type { ComponentKind } from "./catalog";
import { CONFIG } from "./catalog";
import type { Design, DesignEdge, DesignNode } from "./design";
import { removeNode } from "./edit";
import {
  type Cover,
  HldProblem,
  type RequestType,
  type Scenario,
} from "./problem";
import { simulate } from "./simulate";
import { cheapestFee } from "./providers";
import { REGION_NAMES, type SpecVersion, specVersion } from "./spec";

// P6-W40 (HLDQ-2, HLDQ-3; Q-P6-04): problem families. A family is a template: its
// requests, the ranges its numbers are drawn from per battle mode, and the shape of a design
// that solves it. A variant is (family, battle mode, seed); the seed decides every number,
// so the same seed always rebuilds the same problem (replays, disputes).
//
// Every variant is validated before it can be played: its reference design (the
// family's shape, sized by simulation for that variant's numbers) passes every
// scenario, and each flawed design (the reference with one weakness) fails exactly the
// scenario it targets. Only seeds that pass go into the pool (pool.json).

export type BattleMode = "human" | "ai";
type Span = readonly [number, number];

// ADR-0050: what a practice list groups and labels a family by; neither changes a number.
export const THEMES = [
  "storage",
  "feeds",
  "messaging",
  "search",
  "commerce",
  "realtime",
  "pipelines",
  "infrastructure",
] as const;
export type Theme = (typeof THEMES)[number];
export type Difficulty = "easy" | "medium" | "hard";

// ADR-0050 §4: a family's own lesson as a flawed design, where the simulator can show
// it, and what it must fail: a scenario, or `budget` (cost counts in every scenario, so
// a flaw that only costs too much fails all of them on cost alone). A flaw that leaves
// out what does a request type's work (ADR-0051) targets `baseline`, §6.4's gate, and
// fails every scenario with it. The reference:
// - `without` a node, or several (a queue and the workers it feeds);
// - with a node configured the naive way (`configure`, from the reference's config);
// - with a node cut to run at `utilization` on a normal day (sized for the average);
// - `bypass`ing nodes: each removed, its senders sent straight to its targets for the
//   same routes (the synchronous version of an asynchronous design);
// - sending one request type along `route` (node ids) in place of its own edges.
type Config = Record<string, number | string>;
// ADR-0052: what a lesson fails may differ by battle mode (the AI mode's region loss is
// the harsher outage).
export type Lesson = {
  id: string;
  targets: string | Record<BattleMode, string>;
} & (
  | { without: string | string[] }
  | { node: string; configure: (config: Config) => Config }
  | { node: string; utilization: number }
  | { bypass: string[] }
  | { route: { type: string; path: string[] } }
);

// What a variant is made from: a family's, or a cup's (cups are in neither pool).
export type FamilyTemplate = {
  slug: string;
  title: string;
  // ADR-0050 §6: the spec version its variants are validated and played under (1.0
  // when absent); a family on a newer version is drawn only once it's in effect.
  spec?: "2.0" | "2.1";
  // Each with the rule that says what in a design covers it (Q-WD-15).
  requirements: { text: string; covers: Cover }[];
  concepts: string[];
  rubric: HldProblem["rubric"];
  allowedComponents: ComponentKind[];
  // Each request type's share of the traffic, with its spec 2.0 fields (work units,
  // payload, completion target) when it has them.
  requests: (Omit<RequestType, "rps"> & { share: number })[];
  // Q-WD-31: the external provider's price per call, when the family has one; its
  // rate limit is drawn per battle mode (`providerShare`). ADR-0053: or, in its place,
  // what the player picks from: the users' region and channels (the reference's pick
  // is its shape's).
  providerCostPerCall?: number;
  // A card offer's fee target is drawn from the sheet: the cheapest processor's.
  provider?: Omit<
    NonNullable<HldProblem["traffic"]["provider"]>,
    "feeTargetUsd"
  >;
  ranges: Record<
    BattleMode,
    {
      rps: Span; // all request types together, at baseline
      workingSetGb: Span;
      hotKeySkew: Span;
      storedGb: Span;
      growthGbPerDay: Span;
      p99Ms: Span; // the baseline's target
      // The provider's rate limit, as a multiple of all request types together.
      providerShare?: Span;
      // Spec 2.1: clients connected at once, as a multiple of all request types
      // together (a presence client's heartbeat every 30 seconds is about 24).
      connectionsPerRps?: Span;
    }
  >;
  horizonDays: number;
  // The reference design's shape: its nodes at their smallest, and its edges. The
  // sizer sets zones, regions, counts, memory and storage.
  shape: { nodes: DesignNode[]; edges: DesignEdge[] };
  // ADR-0050 §4: the family's own scenarios, run after the shared ones; targets are
  // the baseline's p99 times `p99x`, and an availability.
  scenarios?: (Omit<Scenario, "targets"> & {
    p99x: number;
    availability: number;
  })[];
  // The family's own lessons as flaws, where the simulator can show them. Where it
  // can't, the rubric carries the lesson instead.
  lessons?: Lesson[];
};

// ADR-0048's pattern for HLD (ADR-0050 §1): a practice family is never drawn for a
// match and never moves back to battles; it keeps its practice seed. A battle family
// needs none once the split is on.
export type Family = FamilyTemplate & {
  theme: Theme;
  difficulty: Difficulty;
} & (
    | { pool: "practice"; practiceSeeds: readonly number[] }
    | { pool: "battle"; practiceSeeds?: readonly number[] }
  );

// Q-WD-31: the pools split only once the battle pool keeps at least this many
// families; until then every family is in practice and in matches, as before.
export const SPLIT_AT = 6;
export const poolSplit = (families: readonly Family[]) =>
  families.filter((f) => f.pool === "battle").length >= SPLIT_AT;
export const matchFamilies = (families: readonly Family[]) =>
  poolSplit(families) ? families.filter((f) => f.pool === "battle") : families;
export const practiceFamilies = (families: readonly Family[]) =>
  poolSplit(families)
    ? families.filter((f) => f.pool === "practice")
    : families;

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
// One stream per family and battle mode, so a seed means something different in each.
function streamFor(family: string, battleMode: BattleMode, seed: number) {
  let h = 2166136261;
  for (const c of `${family}/${battleMode}/${String(seed)}`)
    h = Math.imul(h ^ (c.codePointAt(0) ?? 0), 16777619);
  return random(h);
}
// Rounded to its step and then to 2 decimals, so 0.05 steps never show as
// 0.7000000000000001.
const draw = (next: () => number, [lo, hi]: Span, step: number) =>
  Number((Math.round((lo + next() * (hi - lo)) / step) * step).toFixed(2));

const fmt = (x: number) => Math.round(x).toLocaleString("en-US");

// The scenarios every variant runs: a normal day, a spike, a zone's loss; the AI mode
// also loses a region (Q-P6-04). Targets loosen as the scenario gets harder.
function scenarios(
  battleMode: BattleMode,
  p99Ms: number,
  own: FamilyTemplate["scenarios"],
): Scenario[] {
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
  if (battleMode === "ai")
    list.push({
      id: "region",
      name: "A region goes down",
      weight: 2,
      load: 1,
      failure: { scope: "region" },
      targets: { p99Ms: p99Ms * 2, availability: 0.99 },
    });
  for (const { p99x, availability, ...s } of own ?? [])
    list.push({
      ...s,
      targets: { p99Ms: Math.round(p99Ms * p99x), availability },
    });
  return list;
}

// ADR-0053 (owner, 2026-11-24): card fees per payment answer to the cheapest
// processor's in the region, with no headroom, as the budget holds messaging fees.
function withFeeTarget(
  family: FamilyTemplate,
): NonNullable<HldProblem["traffic"]["provider"]> | undefined {
  const offer = family.provider;
  if (offer === undefined || !offer.channels.includes("card")) return offer;
  const target = cheapestFee(specOf(family), offer);
  if (target === null) throw new Error(`${family.slug}: no processor offered`);
  // In cents, rounded up, so the cheapest processor always meets it.
  return { ...offer, feeTargetUsd: Math.ceil(target * 100 - 1e-9) / 100 };
}

// The provider's price, or (ADR-0053) where its users are and what the player picks.
function offerWords(
  p: Pick<HldProblem["traffic"], "providerCostPerCall" | "provider">,
): string {
  if (p.provider === undefined)
    return `, at $${String(p.providerCostPerCall ?? 0)} a call.`;
  const where = REGION_NAMES[p.provider.region];
  return p.provider.ticketUsd === undefined
    ? `. Its users are in ${where}: pick its provider and channel.`
    : `. Its users are in ${where}, paying $${fmt(p.provider.ticketUsd)} on average: pick its provider.`;
}

// The problem a seed makes, before its budget is known (the sizer finds the cost).
export const familySpec = (family: FamilyTemplate) => family.spec ?? "1.0";
const specOf = (family: FamilyTemplate): SpecVersion => {
  const spec = specVersion(familySpec(family));
  if (spec === null)
    throw new Error(`${family.slug}: no spec ${familySpec(family)}`);
  return spec;
};

function draft(
  family: FamilyTemplate,
  battleMode: BattleMode,
  seed: number,
  budget: number,
) {
  const next = streamFor(family.slug, battleMode, seed);
  const r = family.ranges[battleMode];
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
  // Drawn last, so a 1.0 family's numbers are what they always were. ADR-0053: a
  // family that offers a pick draws its rate limit the same way.
  const price =
    family.provider === undefined
      ? family.providerCostPerCall === undefined
        ? null
        : { providerCostPerCall: family.providerCostPerCall }
      : { provider: withFeeTarget(family) };
  const provider =
    r.providerShare === undefined || price === null
      ? null
      : {
          providerRps: Math.round(rps * draw(next, r.providerShare, 0.05)),
          ...price,
        };
  // Drawn after the provider, so no earlier family's numbers move.
  const connections =
    r.connectionsPerRps === undefined
      ? null
      : {
          connections: Math.max(
            1000,
            Math.round((rps * draw(next, r.connectionsPerRps, 1)) / 1000) *
              1000,
          ),
        };
  const needed =
    traffic.storedGb + traffic.growthGbPerDay * traffic.horizonDays;
  const fees = provider?.provider?.feeTargetUsd;
  return HldProblem.parse({
    slug: `${family.slug}-${battleMode}-${String(seed)}`,
    title: family.title,
    battleMode,
    spec: familySpec(family),
    timeLimitMinutes: 30,
    requirements: [
      ...family.requirements.map((r) => r.text),
      `About ${traffic.requests.map((t) => `${fmt(t.rps)} ${t.type.replaceAll("_", " ")}`).join(", ")} requests a second on a normal day.${provider === null ? "" : ` The external provider takes at most ${fmt(provider.providerRps)} calls a second${offerWords(provider)}`}${connections === null ? "" : ` About ${fmt(connections.connections)} clients stay connected.`}`,
      `${fmt(traffic.storedGb)} GB kept today, growing ${String(traffic.growthGbPerDay)} GB a day: ${fmt(needed)} GB within ${String(traffic.horizonDays)} days.`,
      `A budget of $${fmt(budget)} a month.`,
      ...(fees === undefined
        ? []
        : [
            `Processing fees of at most $${fees.toFixed(2)} a payment, paid apart from the budget.`,
          ]),
    ],
    covers: [
      ...family.requirements.map((r) => r.covers),
      { rule: "scenario", scenario: "baseline" },
      { rule: "storage" },
      { rule: "budget" },
      ...(fees === undefined ? [] : [{ rule: "fees" as const }]),
    ],
    traffic: { ...traffic, ...provider, ...connections },
    budgetPerMonth: budget,
    scenarios: scenarios(battleMode, p99Ms, family.scenarios),
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
  // Spec 2.1: a nearby query's cells spread over shards; a gateway adds nodes.
  geo_index: "shards",
  connection_gateway: "nodes",
};
// Compute whose loss a spike shows first; caches and stores keep their memory and
// storage, so a flaw in them would fail every scenario, not one.
const COMPUTE = new Set<ComponentKind>([
  "app_service",
  "worker",
  "queue",
  "stream",
  "connection_gateway",
]);

const maxOf = (kind: ComponentKind, field: string) => {
  const shape = CONFIG[kind].shape as Record<
    string,
    { maxValue?: number | null }
  >;
  return shape[field]?.maxValue ?? 1;
};
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
// A worker whose every request type waits in a queue for it ([lag], spec 2.0) absorbs
// a spike as a backlog: cutting it is the lag lessons' flaw, not the spike's.
const lagConsumer = (design: Design, problem: HldProblem, id: string) => {
  const types = new Set(
    design.edges.filter((e) => e.to === id).flatMap((e) => e.routes),
  );
  return (
    specVersion(design.spec)?.features.lag !== undefined &&
    types.size > 0 &&
    problem.traffic.requests.every(
      (r) => !types.has(r.type) || r.completionSeconds !== undefined,
    )
  );
};

// Spec 2.1: a reconnect storm can make a zone's loss harsher than a spike for the
// nodes behind it; the spike flaw leaves such a node alone (ADR-0052).
const harsherElsewhere = (
  result: ReturnType<typeof simulate>,
  scenario: string,
  id: string,
) => {
  const at = (s: (typeof result.scenarios)[number]) =>
    s.nodes.find((n) => n.id === id)?.utilization ?? 0;
  const here = result.scenarios.find((s) => s.id === scenario);
  return (
    specVersion(result.spec)?.features.gateway !== undefined &&
    here !== undefined &&
    result.scenarios.some((s) => at(s) > at(here))
  );
};

function sizedFor(
  reference: Design,
  problem: HldProblem,
  scenario: string,
  utilization: number,
  only?: string,
): Design {
  const result = simulate(problem, reference);
  const nodes = result.scenarios.find((s) => s.id === scenario)?.nodes;
  return {
    ...reference,
    nodes: reference.nodes.map((n) => {
      const field = COUNT[n.kind];
      const used = nodes?.find((x) => x.id === n.id)?.utilization ?? 0;
      if (
        field === undefined ||
        used === 0 ||
        (only === undefined
          ? !COMPUTE.has(n.kind) ||
            (n.kind === "worker" && lagConsumer(reference, problem, n.id)) ||
            harsherElsewhere(result, scenario, n.id)
          : n.id !== only)
      )
        return n;
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
// battle mode, a standby in another zone, storage for the horizon with room to spare; then
// simulated, and whatever runs above HEADROOM grown, until nothing does.
function size(family: FamilyTemplate, problem: HldProblem): Design {
  const spec = specOf(family);
  const t = problem.traffic;
  const needed = t.storedGb + t.growthGbPerDay * t.horizonDays;
  const regions = problem.battleMode === "ai" ? 2 : 1;
  let design: Design = {
    version: 1,
    spec: spec.version,
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
          Math.ceil((needed * 2) / spec.engine.kvStorageGbPerNode),
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
  family: FamilyTemplate,
  reference: Design,
  problem: HldProblem,
): { id: string; targets: string; design: Design }[] {
  const list = [
    ...(family.lessons ?? []).map((lesson) => ({
      id: lesson.id,
      targets:
        typeof lesson.targets === "string"
          ? lesson.targets
          : lesson.targets[problem.battleMode ?? "human"],
      design: flawed(reference, problem, lesson),
    })),
    // With a second active region, one zone's loss is survivable in any case, so the
    // AI mode's zone flaw is the one-region design below.
    ...(problem.battleMode === "ai"
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
    // Where nothing in the spike's path can be cut (it all waits in a queue, or sits at
    // its smallest), there's no such flaw to make.
    ...[sizedFor(reference, problem, "peak", 1.15)]
      .filter((cut) => JSON.stringify(cut) !== JSON.stringify(reference))
      .map((design) => ({ id: "no-spike-headroom", targets: "peak", design })),
  ];
  if (problem.battleMode === "ai")
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

function flawed(
  reference: Design,
  problem: HldProblem,
  lesson: Lesson,
): Design {
  if ("without" in lesson)
    return [lesson.without].flat().reduce(removeNode, reference);
  if ("configure" in lesson)
    return {
      ...reference,
      nodes: reference.nodes.map((n) =>
        n.id === lesson.node ? withConfig(n, lesson.configure(configOf(n))) : n,
      ),
    };
  if ("utilization" in lesson)
    return sizedFor(
      reference,
      problem,
      "baseline",
      lesson.utilization,
      lesson.node,
    );
  if ("bypass" in lesson) return lesson.bypass.reduce(bypass, reference);
  const { type, path } = lesson.route;
  const on = new Set(
    path.slice(0, -1).map((from, i) => `${from}>${path[i + 1] ?? ""}`),
  );
  // The type leaves the edges it had from the path's first node on, then follows the
  // path; edges left carrying nothing go.
  const after = new Set<string>();
  const todo = [path[0] ?? ""];
  for (let id = todo.pop(); id !== undefined; id = todo.pop())
    for (const e of reference.edges)
      if (e.from === id && e.routes.includes(type) && !after.has(e.to)) {
        after.add(e.to);
        todo.push(e.to);
      }
  const edges = reference.edges
    .map((e) =>
      (e.from === path[0] || after.has(e.from)) && !on.has(`${e.from}>${e.to}`)
        ? { ...e, routes: e.routes.filter((r) => r !== type) }
        : e,
    )
    .filter((e) => e.routes.length > 0);
  for (const pair of on) {
    const [from = "", to = ""] = pair.split(">");
    const at = edges.findIndex((e) => e.from === from && e.to === to);
    const found = edges[at];
    if (found === undefined) edges.push({ from, to, routes: [type] });
    else if (!found.routes.includes(type))
      edges[at] = { ...found, routes: [...found.routes, type] };
  }
  return { ...reference, edges };
}

// A node taken out, its senders sent straight to its targets for the routes both
// carried.
function bypass(design: Design, id: string): Design {
  const into = design.edges.filter((e) => e.to === id);
  const from = design.edges.filter((e) => e.from === id);
  const edges = removeNode(design, id).edges.map((e) => ({ ...e }));
  for (const a of into)
    for (const b of from) {
      const routes = a.routes.filter((r) => b.routes.includes(r));
      if (routes.length === 0 || a.from === b.to) continue;
      const found = edges.find((e) => e.from === a.from && e.to === b.to);
      if (found === undefined) edges.push({ from: a.from, to: b.to, routes });
      else
        found.routes = [
          ...found.routes,
          ...routes.filter((r) => !found.routes.includes(r)),
        ];
    }
  return { ...design, nodes: design.nodes.filter((n) => n.id !== id), edges };
}

type Variant = {
  problem: HldProblem;
  reference: Design;
  flawed: { id: string; targets: string; design: Design }[];
};

export function variant(
  family: FamilyTemplate,
  battleMode: BattleMode,
  seed: number,
): Variant {
  const sizing = draft(family, battleMode, seed, 1e9);
  const reference = size(family, sizing);
  const sized = simulate(sizing, reference);
  // ADR-0053: a picked provider's fees are budgeted at the reference's pick, with no
  // headroom: a dearer pick goes over, and the rest keeps its headroom.
  const fees = sized.providerCostPerMonth ?? 0;
  const budget =
    Math.ceil(
      ((sized.costPerMonth - fees) * (battleMode === "ai" ? 1.2 : 1.5) + fees) /
        100,
    ) * 100;
  return {
    problem: draft(family, battleMode, seed, budget),
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
    // Card fees over their target, and nothing else (owner, 2026-11-24).
    if (f.targets === "fees") {
      const offer = v.problem.traffic.provider;
      const lifted =
        offer === undefined
          ? []
          : simulate(
              {
                ...v.problem,
                traffic: {
                  ...v.problem.traffic,
                  provider: { ...offer, feeTargetUsd: Infinity },
                },
              },
              f.design,
            ).scenarios.filter((s) => !s.targetsMet);
      const over =
        (r.fees?.perPayment ?? 0) > (r.fees?.target ?? Infinity) &&
        r.costPerMonth <= v.problem.budgetPerMonth;
      if (!over || lifted.length > 0)
        problems.push(
          `${f.id} should fail only on its fees per payment but ${over ? `fails ${lifted.map((x) => `"${x.id}"`).join(", ")}` : "is within its fee target or over budget"}`,
        );
      continue;
    }
    if (f.targets === "budget") {
      // Over budget, and nothing else: with the budget lifted it meets every target.
      const lifted = simulate(
        { ...v.problem, budgetPerMonth: Infinity },
        f.design,
      ).scenarios.filter((s) => !s.targetsMet);
      if (r.costPerMonth <= v.problem.budgetPerMonth || lifted.length > 0)
        problems.push(
          `${f.id} should fail only on its cost but ${r.costPerMonth <= v.problem.budgetPerMonth ? "is within budget" : `fails ${lifted.map((x) => `"${x.id}"`).join(", ")}`}`,
        );
      continue;
    }
    const failed = r.scenarios.filter((s) => !s.targetsMet).map((s) => s.id);
    if (f.targets === "baseline") {
      if (!failed.includes("baseline"))
        problems.push(
          `${f.id} should fail "baseline" but fails ${failed.length === 0 ? "nothing" : failed.map((x) => `"${x}"`).join(", ")}`,
        );
      continue;
    }
    if (failed.length !== 1 || failed[0] !== f.targets)
      problems.push(
        `${f.id} should fail only "${f.targets}" but fails ${failed.length === 0 ? "nothing" : failed.map((x) => `"${x}"`).join(", ")}`,
      );
  }
  return problems;
}

// ADR-0050 §6: each family's seeds with the spec version they were validated under; a
// match drawn from them records it and rebuilds its problem under it.
export type Pool = Record<
  string,
  { spec: string } & Record<BattleMode, number[]>
>;
export const POOL_SIZE = 12;

// The first `count` valid seeds of a family in a battle mode, skipping its practice
// seeds (Q-P6-04).
export function validSeeds(
  family: Family,
  battleMode: BattleMode,
  count: number,
): number[] {
  const found: number[] = [];
  for (let seed = 1; found.length < count && seed <= 500; seed++)
    if (
      !(family.practiceSeeds ?? []).includes(seed) &&
      validate(variant(family, battleMode, seed)).length === 0
    )
      found.push(seed);
  return found;
}

// The playable seeds (HLDQ-3): the first POOL_SIZE valid ones per family and battle
// mode, never a practice seed (Q-P6-04). Every family keeps its seeds, so a match played
// before its family moved to practice still rebuilds for its replay and results; new
// matches draw from battle families only (drawVariant, ADR-0050 §1).
// ADR-0050 §1: a practice family has no battle seeds. The families written before 2.1
// keep theirs, so a match played before a family moved to practice still rebuilds.
const SEEDED_PRACTICE = new Set(["1.0", "2.0"]);
const battleSeeded = (f: Family) =>
  f.pool === "battle" || SEEDED_PRACTICE.has(familySpec(f));

export function buildPool(families: readonly Family[]): Pool {
  const pool: Pool = {};
  for (const f of families)
    pool[f.slug] = {
      spec: familySpec(f),
      human: battleSeeded(f) ? validSeeds(f, "human", POOL_SIZE) : [],
      ai: battleSeeded(f) ? validSeeds(f, "ai", POOL_SIZE) : [],
    };
  return pool;
}
