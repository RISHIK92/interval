import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { Design } from "./design";
import { removeNode, updateNode } from "./edit";
import {
  CELLS,
  CLIPS,
  DIRECT,
  FRAGILE,
  IDS,
  LAVISH,
  LEASES,
  LIVE,
  NEARBY,
  PRESENCE,
  QUEUED,
  SHORTENER,
  SIGN_IN,
  SOUND,
  STUDIO,
  TALLY,
  VIEWS,
} from "./fixtures.test-helpers";
import { HldProblem } from "./problem";
import {
  erlangC,
  simulate,
  SIMULATION_POINTS,
  stationLatency,
} from "./simulate";

// P6-W37 (CANVAS-3, CANVAS-5; Q-P6-02): the analytical simulator.

describe("queueing", () => {
  test("Erlang C matches its closed forms", () => {
    expect(erlangC(1, 0.5)).toBeCloseTo(0.5, 10); // M/M/1: P(wait) = ρ
    expect(erlangC(2, 1)).toBeCloseTo(1 / 3, 10);
    // Many servers lightly used rarely wait.
    expect(erlangC(100, 50)).toBeLessThan(1e-6);
  });

  test("an M/M/1 station's p50 and p99 come from its wait's exponential tail", () => {
    // λ = 50, μ = 100: P(W > t) = 0.5·e^(−50t), so p50 has no wait and p99 waits
    // ln(50)/50 s.
    const { p50, p99, utilization } = stationLatency(1, 100, 50, 10);
    expect(utilization).toBe(0.5);
    expect(p50).toBe(10);
    expect(p99).toBeCloseTo(10 + (Math.log(50) / 50) * 1000, 6);
    expect(stationLatency(2, 100, 250, 10).p99).toBe(Infinity); // overloaded
  });
});

describe("a design through the scenarios", () => {
  test("a sound design meets every target and earns the full points", () => {
    const r = simulate(SHORTENER, SOUND);
    expect(r.baselinePassed).toBe(true);
    expect(r.scenarios.every((s) => s.targetsMet)).toBe(true);
    expect(r.points).toBe(SIMULATION_POINTS);
  });

  test("an overloaded design fails the baseline (the rubric gate) and says why", () => {
    const r = simulate(SHORTENER, FRAGILE);
    expect(r.baselinePassed).toBe(false);
    const baseline = r.scenarios.find((s) => s.id === "baseline");
    expect(
      baseline?.explanations.some((e) => e.startsWith("api is overloaded")),
    ).toBe(true);
    // A zone's loss takes the single-zone design down.
    const zone = r.scenarios.find((s) => s.id === "zone");
    expect(zone?.availability).toBe(0);
    expect(r.points).toBeLessThan(SIMULATION_POINTS / 2);
  });

  test("a cache takes reads off the database", () => {
    const db = (design: typeof SOUND) =>
      simulate(SHORTENER, design).scenarios[0]?.nodes.find((n) => n.id === "db")
        ?.loadRps ?? 0;
    const withoutCache = {
      ...SOUND,
      nodes: SOUND.nodes.filter((n) => n.kind !== "cache"),
      edges: SOUND.edges.filter((e) => e.to !== "cache"),
    };
    expect(db(SOUND)).toBeLessThan(db(withoutCache) / 2);
  });

  test("going over budget costs points in every scenario", () => {
    const r = simulate(SHORTENER, LAVISH);
    expect(r.costPerMonth).toBeGreaterThan(SHORTENER.budgetPerMonth);
    expect(r.points).toBeLessThan(SIMULATION_POINTS);
    expect(r.explanations[0]).toMatch(/^Cost: \$/);
  });

  test("components the problem doesn't allow can't be simulated", () => {
    const r = simulate(SHORTENER, {
      ...SOUND,
      nodes: [
        ...SOUND.nodes,
        {
          id: "q",
          kind: "queue",
          config: { partitions: 1, retentionHours: 1, zones: 1, regions: 1 },
          note: "",
        },
      ],
    });
    expect(r.points).toBe(0);
    expect(r.scenarios).toEqual([]);
  });

  test("the same input always gives the same result", () => {
    expect(simulate(SHORTENER, FRAGILE)).toEqual(simulate(SHORTENER, FRAGILE));
  });
});

// Designs that look like they serve but don't (P6-W37 review): a request is served only
// when it reaches somewhere that keeps or does the work.
describe("what counts as served", () => {
  const node = (id: string) => {
    const n = SOUND.nodes.find((x) => x.id === id);
    if (n === undefined) throw new Error(`SOUND has no ${id}`);
    return n;
  };
  const client = node("users");
  const lb = node("lb");
  const api = node("api");
  const cache = node("cache");
  const db = node("db");
  const design = (nodes: Design["nodes"], edges: Design["edges"]): Design => ({
    ...SOUND,
    nodes,
    edges,
  });
  const cdn: Design["nodes"][number] = {
    id: "cdn",
    kind: "cdn",
    config: { ttlSeconds: 86_400 },
    note: "",
  };

  test.each([
    ["a client alone", design([client], [])],
    [
      "a load balancer with nothing behind it",
      design(
        [client, lb],
        [{ from: "users", to: "lb", routes: ["read", "write"] }],
      ),
    ],
    [
      "a CDN with no origin",
      design(
        [client, cdn],
        [{ from: "users", to: "cdn", routes: ["read", "write"] }],
      ),
    ],
    [
      "a cache with no database",
      design(
        [client, api, cache],
        [
          { from: "users", to: "api", routes: ["read", "write"] },
          { from: "api", to: "cache", routes: ["read", "write"] },
        ],
      ),
    ],
  ])("%s scores nothing", (_, d) => {
    const r = simulate(SHORTENER, d);
    expect(r.points).toBe(0);
    expect(r.scenarios.every((s) => s.availability === 0)).toBe(true);
  });

  test("a read-through cache serves like cache-aside, its misses from the database", () => {
    const readThrough = design(
      [client, lb, api, cache, db],
      [
        { from: "users", to: "lb", routes: ["read", "write"] },
        { from: "lb", to: "api", routes: ["read", "write"] },
        { from: "api", to: "cache", routes: ["read"] },
        { from: "cache", to: "db", routes: ["read"] },
        { from: "api", to: "db", routes: ["write"] },
      ],
    );
    const a = simulate(SHORTENER, SOUND).scenarios[0];
    const b = simulate(SHORTENER, readThrough).scenarios[0];
    const dbLoad = (s: typeof a) =>
      s?.nodes.find((n) => n.id === "db")?.loadRps;
    expect(dbLoad(b)).toBe(dbLoad(a));
    expect(b?.availability).toBeGreaterThan(0.999);
  });

  test("a write that only touches a cache isn't kept", () => {
    const r = simulate(
      SHORTENER,
      design(
        [client, api, cache, db],
        [
          { from: "users", to: "api", routes: ["read", "write"] },
          { from: "api", to: "cache", routes: ["read", "write"] },
          { from: "api", to: "db", routes: ["read"] },
        ],
      ),
    );
    const write = r.scenarios[0]?.types.find((t) => t.type === "write");
    expect(write?.availability).toBe(0);
    expect(r.storageGb).toBeNull();
  });
});

describe("work handed to a queue", () => {
  const problem = HldProblem.parse({
    ...SHORTENER,
    allowedComponents: [...SHORTENER.allowedComponents, "queue", "worker"],
  });
  const queued = (withWorker: boolean): Design => ({
    ...SOUND,
    nodes: [
      ...SOUND.nodes,
      {
        id: "q",
        kind: "queue",
        config: { partitions: 4, retentionHours: 24, zones: 2, regions: 1 },
        note: "",
      },
      ...(withWorker
        ? [
            {
              id: "workers",
              kind: "worker" as const,
              config: { nodes: 4, zones: 2, regions: 1 },
              note: "",
            },
          ]
        : []),
    ],
    edges: [
      ...SOUND.edges.filter((e) => !(e.from === "api" && e.to === "db")),
      { from: "api", to: "db", routes: ["read"] },
      { from: "api", to: "q", routes: ["write"] },
      ...(withWorker
        ? [
            { from: "q", to: "workers", routes: ["write"] },
            { from: "workers", to: "db", routes: ["write"] },
          ]
        : []),
    ],
  });

  test("its consumers do the work, off the caller's path", () => {
    const s = simulate(problem, queued(true)).scenarios[0];
    const write = s?.types.find((t) => t.type === "write");
    expect(write?.availability).toBeGreaterThan(0.99);
    expect(s?.nodes.find((n) => n.id === "workers")?.loadRps).toBe(400);
  });

  test("with no consumer, nothing is done", () => {
    const s = simulate(problem, queued(false)).scenarios[0];
    expect(s?.types.find((t) => t.type === "write")?.availability).toBe(0);
    expect(s?.explanations).toContain(
      "q has no consumer: nothing does the work it holds.",
    );
  });
});

// The second review's probes: each design once scored without really serving.
describe("paths that only look complete", () => {
  const open = HldProblem.parse({
    ...SHORTENER,
    allowedComponents: [
      ...SHORTENER.allowedComponents,
      "queue",
      "worker",
      "object_storage",
    ],
  });
  const n = (id: string) => {
    const x = SOUND.nodes.find((y) => y.id === id);
    if (x === undefined) throw new Error(`SOUND has no ${id}`);
    return x;
  };
  const e = (from: string, to: string, ...routes: string[]) => ({
    from,
    to,
    routes,
  });
  const extra = {
    cdn: { id: "cdn", kind: "cdn", config: { ttlSeconds: 3_600 }, note: "" },
    q: {
      id: "q",
      kind: "queue",
      config: { partitions: 4, retentionHours: 24, zones: 2, regions: 1 },
      note: "",
    },
    workers: {
      id: "workers",
      kind: "worker",
      config: { nodes: 8, zones: 2, regions: 1 },
      note: "",
    },
    blobs: {
      id: "blobs",
      kind: "object_storage",
      config: { regions: 1 },
      note: "",
    },
  } as const;
  const served = (d: Design, type: string) =>
    simulate(open, Design.parse(d)).scenarios[0]?.types.find(
      (t) => t.type === type,
    )?.availability ?? -1;

  test("a write passing through a CDN still reaches the database", () => {
    const d: Design = {
      ...SOUND,
      nodes: [...SOUND.nodes, extra.cdn],
      edges: [
        e("users", "cdn", "read", "write"),
        e("cdn", "lb", "read", "write"),
        ...SOUND.edges.filter((x) => x.from !== "users"),
      ],
    };
    expect(served(d, "write")).toBeGreaterThan(0.999);
    expect(served(d, "read")).toBeGreaterThan(0.999);
  });

  test("a write through a read-through cache reaches the database", () => {
    const d: Design = {
      ...SOUND,
      edges: [
        e("users", "lb", "read", "write"),
        e("lb", "api", "read", "write"),
        e("api", "cache", "read", "write"),
        e("cache", "db", "read", "write"),
      ],
    };
    expect(served(d, "write")).toBeGreaterThan(0.999);
  });

  test("which of two caches is drawn first doesn't change the result", () => {
    const second = { ...n("cache"), id: "cache2" };
    const edges = (first: string, then: string) => [
      e("users", "api", "read", "write"),
      e("api", first, "read"),
      e("api", then, "read"),
      e("api", "db", "write"),
      e("cache2", "db", "read"),
    ];
    const d = (a: string, b: string): Design => ({
      ...SOUND,
      nodes: [n("users"), n("api"), n("cache"), second, n("db")],
      edges: edges(a, b),
    });
    expect(served(d("cache", "cache2"), "read")).toBe(
      served(d("cache2", "cache"), "read"),
    );
    expect(served(d("cache", "cache2"), "read")).toBeGreaterThan(0.999);
  });

  test("a queue and its worker can't answer reads", () => {
    const d: Design = {
      ...SOUND,
      nodes: [n("users"), extra.q, extra.workers],
      edges: [
        e("users", "q", "read", "write"),
        e("q", "workers", "read", "write"),
      ],
    };
    expect(served(d, "read")).toBe(0);
  });

  test("a worker called directly isn't where reads are answered", () => {
    const d: Design = {
      ...SOUND,
      nodes: [n("users"), n("api"), extra.workers, n("db")],
      edges: [
        e("users", "api", "read", "write"),
        e("api", "workers", "read"),
        e("api", "db", "write"),
      ],
    };
    expect(served(d, "read")).toBe(0);
  });

  test("storage counts only stores a write can reach, and object storage bills per GB", () => {
    const orphan: Design = {
      ...SOUND,
      nodes: [...SOUND.nodes, { ...n("api"), id: "orphan" }, extra.blobs],
      edges: [...SOUND.edges, e("orphan", "blobs", "write")],
    };
    const r = simulate(open, Design.parse(orphan));
    expect(r.storageGb).toBe(2_000);
    const kept: Design = {
      ...SOUND,
      nodes: [...SOUND.nodes, extra.blobs],
      edges: [...SOUND.edges, e("api", "blobs", "write")],
    };
    const k = simulate(open, Design.parse(kept));
    const sound = simulate(open, SOUND);
    // The database must still hold it all; the blobs add their per-GB bill.
    expect(k.storageGb).toBe(2_000);
    expect(k.costPerMonth).toBeGreaterThan(
      sound.costPerMonth + 0.023 * k.storageNeededGb,
    );
  });

  test("a primary lost with no standby stops writes, and nothing is infinite", () => {
    const d: Design = {
      ...SOUND,
      nodes: SOUND.nodes.map((x) =>
        x.kind === "sql_db"
          ? { ...x, config: { ...x.config, failover: "none" } }
          : x,
      ),
    };
    const problem = HldProblem.parse({
      ...SHORTENER,
      scenarios: [
        ...SHORTENER.scenarios,
        {
          id: "db_node",
          name: "The primary fails",
          weight: 1,
          load: 1,
          failure: { scope: "node", kind: "sql_db" },
          targets: { p99Ms: 100, availability: 0.99 },
        },
      ],
    });
    const s = simulate(problem, d).scenarios.find((x) => x.id === "db_node");
    expect(s?.types.find((t) => t.type === "write")?.availability).toBe(0);
    expect(
      s?.types.find((t) => t.type === "read")?.availability,
    ).toBeGreaterThan(0.99);
    expect(s?.explanations).toContain(
      "db has lost its primary and has no standby: writes stop.",
    );
    expect(s?.nodes.find((x) => x.id === "db")?.utilization).toEqual(
      expect.any(Number),
    );
    expect(
      s?.nodes.every(
        (x) => x.utilization === null || Number.isFinite(x.utilization),
      ),
    ).toBe(true);
  });

  test("object storage in two regions survives losing one", () => {
    const blobs = (regions: number): Design => ({
      ...SOUND,
      nodes: [
        ...SOUND.nodes.map((x) =>
          "regions" in x.config
            ? ({ ...x, config: { ...x.config, regions: 2 } } as typeof x)
            : x,
        ),
        { ...extra.blobs, config: { regions } },
      ],
      edges: [...SOUND.edges, e("api", "blobs", "write")],
    });
    const problem = HldProblem.parse({
      ...open,
      scenarios: [
        ...open.scenarios,
        {
          id: "region",
          name: "A region goes down",
          weight: 1,
          load: 1,
          failure: { scope: "region" },
          targets: { p99Ms: 200, availability: 0.99 },
        },
      ],
    });
    const lost = (regions: number) =>
      simulate(problem, Design.parse(blobs(regions)))
        .scenarios.find((s) => s.id === "region")
        ?.nodes.find((x) => x.id === "blobs")?.up;
    expect(lost(2)).toBe(true);
    expect(lost(1)).toBe(false);
  });

  test("a route listed twice on one edge is refused", () => {
    expect(
      Design.safeParse({
        ...SOUND,
        edges: [
          e("users", "lb", "read", "read", "write"),
          ...SOUND.edges.slice(1),
        ],
      }).success,
    ).toBe(false);
  });
});

test("a spec version that doesn't exist gives an empty result, not an error", () => {
  const r = simulate(SHORTENER, { ...SOUND, spec: "9.9" });
  expect(r.points).toBe(0);
  expect(r.explanations).toEqual(["There's no spec version 9.9."]);
});

// CANVAS-3: regression-tested against golden designs. A change to the engine that moves
// a golden result fails here; UPDATE_GOLDEN=1 rewrites them after a deliberate change
// (and a spec version's balance patch says so in its notes).
// The first three stay pinned to spec 1.0 for ever (ADR-0050 §6): a 1.0 design's result
// never moves when a new version lands. The next three are spec 2.0's, one per new
// component and behaviour, and pinned likewise; the last four are 2.1's.
describe("golden designs", () => {
  const goldens = {
    SOUND: [SHORTENER, SOUND],
    FRAGILE: [SHORTENER, FRAGILE],
    LAVISH: [SHORTENER, LAVISH],
    QUEUED: [SIGN_IN, QUEUED],
    DIRECT: [SIGN_IN, DIRECT],
    STUDIO: [CLIPS, STUDIO],
    CELLS: [NEARBY, CELLS],
    LIVE: [PRESENCE, LIVE],
    LEASES: [IDS, LEASES],
    TALLY: [VIEWS, TALLY],
  } as const;
  for (const [name, [problem, design]] of Object.entries(goldens)) {
    test(`${name} gives its recorded result`, () => {
      const file = join(
        import.meta.dirname,
        "golden",
        `${name.toLowerCase()}.json`,
      );
      const got = JSON.parse(
        JSON.stringify(simulate(problem, design)),
      ) as unknown;
      if (process.env["UPDATE_GOLDEN"] === "1")
        writeFileSync(file, `${JSON.stringify(got, null, 2)}\n`);
      expect(got).toEqual(JSON.parse(readFileSync(file, "utf8")));
    });
  }
});

// ADR-0050 stage 1: spec 2.0's component and behaviours, each on only where the
// design's version has it and the problem sets its field.
describe("spec 2.0", () => {
  const scenario = (r: ReturnType<typeof simulate>, id: string) => {
    const s = r.scenarios.find((x) => x.id === id);
    if (s === undefined) throw new Error(`no scenario ${id}`);
    return s;
  };
  const node = (r: ReturnType<typeof simulate>, id: string, at: string) =>
    scenario(r, at).nodes.find((n) => n.id === id);
  const type = (r: ReturnType<typeof simulate>, t: string, at: string) =>
    scenario(r, at).types.find((x) => x.type === t);

  test("a 1.0 problem simulates the same under 2.0: every behaviour is opt-in", () => {
    const v1 = simulate(SHORTENER, SOUND);
    const v2 = simulate(SHORTENER, { ...SOUND, spec: "2.0" });
    expect({ ...v2, spec: "1.0" }).toEqual(v1);
  });

  test("a 2.0 problem's fields do nothing to a design drawn against 1.0", () => {
    const asV1 = simulate(CLIPS, { ...STUDIO, spec: "1.0" });
    // No work units, no bytes, no backlog: the transcoders see one job an upload.
    expect(node(asV1, "transcoders", "baseline")?.loadRps).toBe(20);
    expect(node(asV1, "api", "baseline")?.utilization).toBe(0.01);
    expect(type(asV1, "upload", "baseline")?.lagSeconds).toBeUndefined();
    expect(asV1.explanations).not.toContainEqual(
      expect.stringMatching(/^Of which/),
    );
  });

  test("the external provider is one station at the problem's rate limit, billed per call", () => {
    const r = simulate(SIGN_IN, QUEUED);
    expect(node(r, "sms", "baseline")).toMatchObject({
      loadRps: 80,
      utilization: 0.2,
    });
    expect(node(r, "sms", "peak")?.utilization).toBe(0.6);
    // 80 sends a second for a month at $0.0001 each.
    expect(r.explanations).toContain(
      "Of which $21,024 is the provider's calls and $0 is bytes served.",
    );
  });

  test("called inside the request, the provider's outage fails what calls it", () => {
    const r = simulate(SIGN_IN, DIRECT);
    expect(scenario(r, "baseline").targetsMet).toBe(true);
    // Its 250 ms is the caller's.
    expect(type(r, "send_code", "baseline")?.p99Ms).toBeGreaterThan(250);
    expect(type(r, "send_code", "provider_down")?.availability).toBe(0);
    expect(scenario(r, "provider_down").targetsMet).toBe(false);
    // It fails at once, so the scenario's p99 is the types that are served.
    expect(scenario(r, "provider_down").p99Ms).toBe(
      Math.max(
        ...scenario(r, "provider_down")
          .types.filter((t) => t.type !== "send_code")
          .map((t) => t.p99Ms ?? 0),
      ),
    );
  });

  test("queued, the outage is a backlog, drained within the target", () => {
    const r = simulate(SIGN_IN, QUEUED);
    expect(r.scenarios.every((s) => s.targetsMet)).toBe(true);
    // 80 a second for 10 minutes, drained at the 320 a second the provider has spare.
    expect(scenario(r, "provider_down").explanations).toContain(
      'q holds 48,000 "send_code" requests at the worst and has done them 13 minutes later (target 15 minutes, retention 24 hours).',
    );
    // Served as on a normal day (its synchronous part's availability), only later.
    expect(type(r, "send_code", "provider_down")).toMatchObject({
      availability: type(r, "send_code", "baseline")?.availability,
      lagSeconds: 750,
    });
    // A normal day's lag is the consumers' p99, not the caller's.
    expect(type(r, "send_code", "baseline")?.lagSeconds).toBeLessThan(1);
    expect(type(r, "send_code", "baseline")?.p99Ms).toBeLessThan(100);
  });

  test("past the completion target, the share of the backlog beyond it isn't served", () => {
    const long = HldProblem.parse({
      ...SIGN_IN,
      scenarios: SIGN_IN.scenarios.map((s) =>
        s.id === "provider_down" ? { ...s, minutes: 30 } : s,
      ),
    });
    const r = simulate(long, QUEUED);
    const day = type(r, "send_code", "baseline")?.availability ?? 0;
    // 30 minutes down and 7.5 draining: 2,250 s at the worst, against 900.
    expect(type(r, "send_code", "provider_down")?.availability).toBeCloseTo(
      (day * 900) / 2_250,
      6,
    );
    expect(scenario(r, "provider_down").explanations).toContain(
      '60.0% of "send_code" isn\'t done in time: the backlog drains too slowly.',
    );
  });

  test("past the queue's retention, the backlog is lost", () => {
    const patient = HldProblem.parse({
      ...SIGN_IN,
      traffic: {
        ...SIGN_IN.traffic,
        requests: SIGN_IN.traffic.requests.map((t) =>
          t.type === "send_code" ? { ...t, completionSeconds: 86_400 } : t,
        ),
      },
      scenarios: SIGN_IN.scenarios.map((s) =>
        s.id === "provider_down" ? { ...s, minutes: 120 } : s,
      ),
    });
    const retained = (hours: number) =>
      updateNode(QUEUED, "q", { config: { retentionHours: hours } });
    // Two hours down, half an hour draining: 9,000 s at the worst.
    const kept = simulate(patient, retained(24));
    const day = type(kept, "send_code", "baseline")?.availability ?? 0;
    expect(type(kept, "send_code", "provider_down")?.availability).toBe(day);
    const lost = simulate(patient, retained(1));
    expect(type(lost, "send_code", "provider_down")?.availability).toBeCloseTo(
      (day * 3_600) / 9_000,
      6,
    );
    expect(scenario(lost, "provider_down").explanations).toContain(
      '60.0% of "send_code" isn\'t done in time: the backlog outlives the retention.',
    );
  });

  test("a job's work units load a worker, and a burst beyond it backs up", () => {
    const r = simulate(CLIPS, STUDIO);
    // 20 uploads a second at 300 jobs each, on 40 nodes of 200 jobs.
    expect(node(r, "transcoders", "baseline")).toMatchObject({
      loadRps: 6_000,
      utilization: 0.75,
    });
    // Three times the uploads for two hours: twelve hours behind at the worst.
    expect(type(r, "upload", "uploads")?.lagSeconds).toBe(43_200);
    expect(scenario(r, "uploads").targetsMet).toBe(false);
    const more = simulate(
      CLIPS,
      updateNode(STUDIO, "transcoders", { config: { nodes: 120 } }),
    );
    expect(scenario(more, "uploads").targetsMet).toBe(true);
  });

  test("late work misses the target however small its share of the traffic", () => {
    const rare = HldProblem.parse({
      ...CLIPS,
      traffic: {
        ...CLIPS.traffic,
        requests: CLIPS.traffic.requests.map((t) =>
          t.type === "upload" ? { ...t, rps: 2 } : t,
        ),
      },
    });
    const slow = updateNode(STUDIO, "transcoders", { config: { nodes: 4 } });
    const s = scenario(simulate(rare, slow), "uploads");
    // One upload in a thousand: the views alone keep 99.9% served.
    expect(s.availability).toBeGreaterThan(0.995);
    expect(s.targetsMet).toBe(false);
  });

  test("bytes fill an app service as requests do, and the larger counts", () => {
    // 20 uploads of 2 MB are 320 Mbps: 8% of 4 nodes' 4,000 Mbps, against 0.5% by count.
    expect(node(simulate(CLIPS, STUDIO), "api", "baseline")?.utilization).toBe(
      0.08,
    );
  });

  test("egress is billed by what hands the bytes to the client", () => {
    const viaCdn = simulate(CLIPS, STUDIO);
    // 1 GB a second of views for a month: $0.02 a GB from the CDN, $0.09 from storage.
    expect(viaCdn.explanations).toContain(
      "Of which $0 is the provider's calls and $52,560 is bytes served.",
    );
    const direct = simulate(CLIPS, {
      ...STUDIO,
      nodes: STUDIO.nodes.filter((n) => n.id !== "edge"),
      edges: [
        ...STUDIO.edges.filter((e) => e.from !== "edge" && e.to !== "edge"),
        { from: "users", to: "files", routes: ["view"] },
      ],
    });
    expect(direct.explanations).toContain(
      "Of which $0 is the provider's calls and $236,520 is bytes served.",
    );
  });

  // ADR-0051: what a request type requires must do its work; a design that leaves it
  // out (the provider dropped, the queue to the workers gone) doesn't serve the type,
  // however cheap it is.
  test("a type whose path never reaches what it requires isn't served", () => {
    const noSms = simulate(SIGN_IN, removeNode(QUEUED, "sms"));
    expect(type(noSms, "send_code", "baseline")).toMatchObject({
      availability: 0,
      p99Ms: null,
    });
    expect(scenario(noSms, "baseline").targetsMet).toBe(false);
    expect(scenario(noSms, "baseline").explanations).toContain(
      '"send_code" requests never reach an external provider, which does their work, so none is served.',
    );
    expect(noSms.points).toBeLessThan(simulate(SIGN_IN, QUEUED).points);
    // No queue: the uploads are stored and never transcoded.
    const noJobs = simulate(CLIPS, removeNode(STUDIO, "jobs"));
    expect(type(noJobs, "upload", "baseline")?.availability).toBe(0);
    expect(scenario(noJobs, "baseline").explanations).toContain(
      '"upload" requests never reach a worker, which does their work, so none is served.',
    );
    expect(noJobs.points).toBeLessThan(simulate(CLIPS, STUDIO).points);
    // A 1.0 design has no such rule.
    expect(
      type(
        simulate(CLIPS, { ...removeNode(STUDIO, "jobs"), spec: "1.0" }),
        "upload",
        "baseline",
      )?.availability,
    ).toBeGreaterThan(0);
  });

  test("a kind the design's spec version lacks gives an empty result, not an error", () => {
    const r = simulate(SIGN_IN, { ...QUEUED, spec: "1.0" });
    expect(r.points).toBe(0);
    expect(r.explanations).toEqual([
      "sms: spec 1.0 has no external provider, so the design can't be simulated.",
    ]);
  });

  test("a backlog that never drains has no lag to give: null, which JSON keeps", () => {
    // 20 uploads at 300 jobs on 20 nodes of 200: over capacity on a normal day.
    const r = simulate(
      CLIPS,
      updateNode(STUDIO, "transcoders", { config: { nodes: 20 } }),
    );
    expect(type(r, "upload", "baseline")?.lagSeconds).toBeNull();
    expect(
      (JSON.parse(JSON.stringify(r)) as typeof r).scenarios[0]?.types.find(
        (t) => t.type === "upload",
      )?.lagSeconds,
    ).toBeNull();
    expect(scenario(r, "baseline").explanations).toContainEqual(
      expect.stringMatching(/never catches up/),
    );
  });

  test("the provider's calls and the bytes served are both billed from the baseline's loads", () => {
    const doubled = (p: HldProblem) =>
      HldProblem.parse({
        ...p,
        scenarios: p.scenarios.map((s) =>
          s.id === "baseline" ? { ...s, load: 2 } : s,
        ),
      });
    expect(simulate(doubled(SIGN_IN), QUEUED).explanations).toContain(
      "Of which $42,048 is the provider's calls and $0 is bytes served.",
    );
    expect(simulate(doubled(CLIPS), STUDIO).explanations).toContain(
      "Of which $0 is the provider's calls and $105,120 is bytes served.",
    );
  });

  test("a node full of bytes says so: its bandwidth, not its requests", () => {
    // 20 uploads of 40 MB: 6,400 Mbps against 4 nodes' 4,000.
    const heavy = HldProblem.parse({
      ...CLIPS,
      traffic: {
        ...CLIPS.traffic,
        requests: CLIPS.traffic.requests.map((t) =>
          t.type === "upload" ? { ...t, payloadKb: 40_000 } : t,
        ),
      },
    });
    const notes = scenario(simulate(heavy, STUDIO), "baseline").explanations;
    expect(notes).toContain(
      "api is overloaded: 6,400 Mbps is 160.0% of the bandwidth its 4 server(s) have.",
    );
  });

  test("a provider fails only when its scenario says so: never with our zone", () => {
    const zone = HldProblem.parse({
      ...SIGN_IN,
      scenarios: [
        ...SIGN_IN.scenarios,
        {
          id: "zone",
          name: "A zone goes down",
          weight: 1,
          load: 1,
          failure: { scope: "zone" },
          targets: { p99Ms: 600, availability: 0.99 },
        },
      ],
    });
    expect(node(simulate(zone, QUEUED), "sms", "zone")?.up).toBe(true);
  });
});

// Phase 6's "done when": 95% of simulations finish within 2 s. The largest design the
// schema allows, layered so that paths multiply (40 nodes, 80 edges), simulates far
// inside it: the engine is linear in the design.
test("the largest design simulates far inside 2 seconds", () => {
  const apis = Array.from({ length: 38 }, (_, i) => ({
    id: `api${String(i)}`,
    kind: "app_service" as const,
    config: { nodes: 10, zones: 2, regions: 1 },
    note: "",
  }));
  const edges: Design["edges"] = [
    { from: "users", to: "api0", routes: ["read", "write"] },
    { from: "users", to: "api1", routes: ["read", "write"] },
  ];
  // Layers of two, each node calling both of the next layer's.
  for (let i = 0; i + 2 < apis.length; i++)
    for (const j of [2, 3]) {
      const to = i - (i % 2) + j;
      if (to < apis.length)
        edges.push({
          from: `api${String(i)}`,
          to: `api${String(to)}`,
          routes: ["read", "write"],
        });
    }
  edges.push({ from: "api37", to: "db", routes: ["read", "write"] });
  const d = Design.parse({
    ...SOUND,
    nodes: [SOUND.nodes[0], ...apis, SOUND.nodes[4]],
    edges: edges.slice(0, 80),
  });
  const started = performance.now();
  simulate(SHORTENER, d);
  expect(performance.now() - started).toBeLessThan(500);
});

// ADR-0050's consequences: the same budget with spec 2.0's kinds and behaviours, a
// backlog behind every layer of queues and workers, each worker calling a provider.
test("the largest 2.0 design, queues, workers and providers, simulates far inside 2 seconds", () => {
  const nodes: Design["nodes"] = [
    { id: "users", kind: "client", config: {}, note: "" },
    {
      id: "api",
      kind: "app_service",
      config: { nodes: 10, zones: 2, regions: 1 },
      note: "",
    },
  ];
  const edges: Design["edges"] = [
    { from: "users", to: "api", routes: ["session", "send_code", "verify"] },
  ];
  for (let i = 0; i < 12; i++) {
    const [q, w, p] = [`q${String(i)}`, `w${String(i)}`, `p${String(i)}`];
    nodes.push(
      {
        id: q,
        kind: "queue",
        config: { partitions: 2, retentionHours: 24, zones: 2, regions: 1 },
        note: "",
      },
      {
        id: w,
        kind: "worker",
        config: { nodes: 2, zones: 2, regions: 1 },
        note: "",
      },
      { id: p, kind: "external_api", config: {}, note: "" },
    );
    edges.push(
      { from: "api", to: q, routes: ["send_code"] },
      { from: q, to: w, routes: ["send_code"] },
      { from: w, to: p, routes: ["send_code"] },
    );
  }
  nodes.push({
    id: "codes",
    kind: "kv_store",
    config: { nodes: 3, replication: 3, zones: 3, regions: 1 },
    note: "",
  });
  edges.push({ from: "api", to: "codes", routes: ["session", "verify"] });
  const d = Design.parse({ version: 1, spec: "2.0", nodes, edges });
  expect(d.nodes).toHaveLength(39);
  const started = performance.now();
  simulate(SIGN_IN, d);
  expect(performance.now() - started).toBeLessThan(500);
});

// ADR-0050 stage 2 (ADR-0052): spec 2.1's components and behaviours, each on only where
// the design's version has it and the problem sets its field.
describe("spec 2.1", () => {
  const scenario = (r: ReturnType<typeof simulate>, id: string) => {
    const s = r.scenarios.find((x) => x.id === id);
    if (s === undefined) throw new Error(`no scenario ${id}`);
    return s;
  };
  const node = (r: ReturnType<typeof simulate>, id: string, at: string) =>
    scenario(r, at).nodes.find((n) => n.id === id);
  const type = (r: ReturnType<typeof simulate>, t: string, at: string) =>
    scenario(r, at).types.find((x) => x.type === t);

  test("1.0 and 2.0 problems simulate the same under 2.1: every behaviour is opt-in", () => {
    const as21 = (d: Design) => ({
      ...d,
      spec: "2.1",
      nodes: d.nodes.map((n) =>
        n.kind === "app_service" || n.kind === "worker"
          ? { ...n, config: { ...n.config, batch: 1 } }
          : n,
      ),
    });
    const strip = (r: ReturnType<typeof simulate>) => ({ ...r, spec: "" });
    expect(strip(simulate(SHORTENER, as21(SOUND)))).toEqual(
      strip(simulate(SHORTENER, SOUND)),
    );
    expect(strip(simulate(SIGN_IN, as21(QUEUED)))).toEqual(
      strip(simulate(SIGN_IN, QUEUED)),
    );
    expect(strip(simulate(CLIPS, as21(STUDIO)))).toEqual(
      strip(simulate(CLIPS, STUDIO)),
    );
  });

  test("2.1's kinds can't be simulated under 2.0", () => {
    expect(simulate(NEARBY, { ...CELLS, spec: "2.0" }).explanations).toEqual([
      "places: spec 2.0 has no geo index, so the design can't be simulated.",
    ]);
  });

  test("a nearby query asks 3 shards, not all of them, so shards add query capacity", () => {
    // 8,000 queries of 3 shard visits on 8 shards of 2 replicas at 5,000 each.
    expect(node(simulate(NEARBY, CELLS), "places", "baseline")).toMatchObject({
      loadRps: 24_000 + 2_000,
      utilization: 0.3,
    });
    const wider = updateNode(CELLS, "places", {
      config: { shards: 16, replicas: 1, zones: 2, regions: 1 },
    });
    expect(
      node(simulate(NEARBY, wider), "places", "baseline")?.utilization,
    ).toBe(0.15);
    // Two shards: each query asks both.
    const narrow = updateNode(CELLS, "places", {
      config: { shards: 2, replicas: 3, zones: 2, regions: 1 },
    });
    expect(node(simulate(NEARBY, narrow), "places", "baseline")).toMatchObject({
      loadRps: 16_000 + 2_000,
      utilization: 0.4,
    });
  });

  test("a geo index keeps positions, never history: it isn't where writes are kept", () => {
    const kept = HldProblem.parse({
      ...NEARBY,
      traffic: { ...NEARBY.traffic, storedGb: 10 },
    });
    const r = simulate(kept, CELLS);
    expect(r.writesKept).toBe(false);
    expect(r.explanations).toContain(
      "Storage: no write reaches a database or store, so nothing is kept.",
    );
  });

  test("a geo shard with no copy goes down with its node", () => {
    const lone = updateNode(CELLS, "places", {
      config: { shards: 8, replicas: 0, zones: 2, regions: 1 },
    });
    const node1 = HldProblem.parse({
      ...NEARBY,
      scenarios: [
        ...NEARBY.scenarios,
        {
          id: "geo_node",
          name: "A geo node dies",
          weight: 1,
          load: 1,
          failure: { scope: "node", kind: "geo_index" },
          targets: { p99Ms: 150, availability: 0.99 },
        },
      ],
    });
    expect(node(simulate(node1, lone), "places", "geo_node")?.up).toBe(false);
    expect(node(simulate(node1, CELLS), "places", "geo_node")?.up).toBe(true);
  });

  test("a gateway fills on connections or messages, whichever is nearer its limit", () => {
    const r = simulate(PRESENCE, LIVE);
    // 400,000 connections on 10 nodes of 50,000; 20,000 messages a second on 200,000.
    expect(node(r, "gw", "baseline")).toMatchObject({
      loadRps: 20_000,
      utilization: 0.8,
    });
    const few = simulate(
      PRESENCE,
      updateNode(LIVE, "gw", { config: { nodes: 6, zones: 2, regions: 1 } }),
    );
    expect(scenario(few, "baseline").explanations).toContain(
      "gw is overloaded: 400,000 connections is 133.3% of what its 6 server(s) hold.",
    );
  });

  test("fan-out: after the first worker behind the stream, every hop carries the mean", () => {
    const r = simulate(PRESENCE, LIVE);
    expect(node(r, "fanners", "baseline")?.loadRps).toBe(1_000);
    expect(node(r, "gw", "baseline")?.loadRps).toBe(20_000);
    // Its deliveries go out 50 at a time: at the p99, 10 rounds of the gateway, or
    // 1,000 for 50,000 contacts.
    const wide = simulate(
      HldProblem.parse({
        ...PRESENCE,
        traffic: {
          ...PRESENCE.traffic,
          requests: PRESENCE.traffic.requests.map((t) =>
            t.type === "status"
              ? { ...t, fanout: { mean: 20, p99: 50_000 } }
              : t,
          ),
        },
      }),
      LIVE,
    );
    const lag = (x: ReturnType<typeof simulate>) =>
      type(x, "status", "baseline")?.lagSeconds ?? 0;
    expect(lag(wide)).toBeGreaterThan(lag(r) + 1);
  });

  test("with no queue, fan-out starts at the first app service, and the caller waits for it", () => {
    const sync = HldProblem.parse({
      ...PRESENCE,
      traffic: {
        ...PRESENCE.traffic,
        requests: PRESENCE.traffic.requests.map((t) =>
          t.type === "status" ? { ...t, completionSeconds: undefined } : t,
        ),
      },
    });
    const direct = {
      ...LIVE,
      nodes: LIVE.nodes.filter((n) => n.id !== "changes" && n.id !== "fanners"),
      edges: [
        ...LIVE.edges.filter(
          (e) => !["changes", "fanners"].includes(e.from) && e.to !== "changes",
        ),
        { from: "api", to: "gw", routes: ["status"] },
      ],
    };
    const r = simulate(sync, direct);
    expect(node(r, "gw", "baseline")?.loadRps).toBe(20_000);
    // 10 rounds of the gateway's p99 after the app service.
    expect(type(r, "status", "baseline")?.p99Ms).toBeGreaterThan(
      (node(r, "gw", "baseline")?.p99Ms ?? 0) * 10,
    );
  });

  test("a pushed type is done when it reaches a gateway, and not without one when it requires it", () => {
    const r = simulate(PRESENCE, removeNode(LIVE, "gw"));
    expect(type(r, "status", "baseline")?.availability).toBe(0);
    expect(scenario(r, "baseline").explanations).toContain(
      '"status" requests never reach a connection gateway, which does their work, so none is served.',
    );
    expect(
      type(simulate(PRESENCE, LIVE), "status", "baseline")?.availability,
    ).toBeGreaterThan(0.999);
  });

  test("losing a gateway node sends its clients back: a reconnect storm on connect", () => {
    const r = simulate(PRESENCE, LIVE);
    // A tenth of 400,000 clients over 30 seconds.
    expect(scenario(r, "gateway_node").explanations).toContain(
      "gw loses 10.0% of its servers: 1,333 reconnects a second for 30 seconds.",
    );
    // The session store and app services see it on connect.
    expect(node(r, "sessions", "gateway_node")?.loadRps).toBeCloseTo(
      (node(r, "sessions", "baseline")?.loadRps ?? 0) + 1_333.3,
      0,
    );
    expect(scenario(r, "baseline").explanations).not.toContainEqual(
      expect.stringMatching(/reconnects/),
    );
  });

  test("a coordinator's leader commits about 4,000 writes a second at 3 members, fewer with more", () => {
    const r = simulate(IDS, LEASES);
    // Blocks of 1,000: 20 lease writes a second; 8 ms plus 2 across zones.
    expect(node(r, "coord", "baseline")).toMatchObject({
      loadRps: 20,
      p99Ms: 10,
    });
    const unbatched = simulate(
      IDS,
      updateNode(LEASES, "api", {
        config: { nodes: 40, batch: 1, zones: 2, regions: 1 },
      }),
    );
    expect(node(unbatched, "coord", "baseline")?.utilization).toBe(5);
    expect(scenario(unbatched, "baseline").targetsMet).toBe(false);
    const five = simulate(
      IDS,
      updateNode(LEASES, "api", {
        config: { nodes: 40, batch: 10, zones: 2, regions: 1 },
      }),
    );
    const seven = simulate(
      IDS,
      updateNode(
        updateNode(LEASES, "api", {
          config: { nodes: 40, batch: 10, zones: 2, regions: 1 },
        }),
        "coord",
        { config: { members: 7, zones: 3, regions: 1 } },
      ),
    );
    // 2,000 writes against 4,000, then against 4,000 × 3 / 7.
    expect(node(five, "coord", "baseline")?.utilization).toBe(0.5);
    expect(node(seven, "coord", "baseline")?.utilization).toBe(1.17);
  });

  test("a coordinator is down below a majority: 3 members in 2 zones lose one zone's 2", () => {
    const two = updateNode(LEASES, "coord", {
      config: { members: 3, zones: 2, regions: 1 },
    });
    const r = simulate(IDS, two);
    expect(node(r, "coord", "zone")?.up).toBe(false);
    expect(scenario(r, "zone").explanations).toContain(
      "coord has lost its quorum: 1 of 3 members left, and it needs 2.",
    );
    expect(node(simulate(IDS, LEASES), "coord", "zone")?.up).toBe(true);
    // Five in three zones lose two and keep three.
    const five = updateNode(LEASES, "coord", {
      config: { members: 5, zones: 3, regions: 1 },
    });
    expect(node(simulate(IDS, five), "coord", "zone")?.up).toBe(true);
  });

  test("a coordinator holds at most 8 GB: data kept there runs out of room", () => {
    const big = HldProblem.parse({
      ...IDS,
      traffic: { ...IDS.traffic, storedGb: 50 },
    });
    const r = simulate(big, LEASES);
    expect(r.storageGb).toBe(8);
    expect(r.explanations).toContain(
      "Storage: 50 GB needed by day 30; where writes are kept holds 8 GB.",
    );
  });

  test("a hot key overloads its partition while the rest have room", () => {
    const direct = {
      ...TALLY,
      nodes: TALLY.nodes.filter((n) => n.id !== "events" && n.id !== "adders"),
      edges: [
        ...TALLY.edges.filter(
          (e) => !["events", "adders"].includes(e.from) && e.to !== "events",
        ),
        { from: "api", to: "counts", routes: ["view"] },
      ],
    };
    const sync = HldProblem.parse({
      ...VIEWS,
      traffic: {
        ...VIEWS.traffic,
        requests: VIEWS.traffic.requests.map((t) => ({
          ...t,
          completionSeconds: undefined,
        })),
      },
    });
    const r = simulate(sync, direct);
    // 80% of 30,000 on one node of 20,000, while the 4 nodes' even share is 7,500.
    expect(node(r, "counts", "baseline")?.utilization).toBe(1.2);
    expect(scenario(r, "baseline").explanations).toContain(
      "counts's busiest partition is overloaded: a hot key puts 120.0% of one server's capacity on it while the rest have room.",
    );
    expect(type(r, "view", "baseline")?.availability).toBeCloseTo(
      1 - 4_000 / 30_000,
      3,
    );
  });

  // The reviewer's cases (ADR-0052): no way around fan-out, batching or a lost zone.
  test("a type that goes to many, with nothing to send its deliveries, isn't served", () => {
    const bare = {
      ...LIVE,
      edges: [
        ...LIVE.edges.filter((e) => !e.routes.includes("status")),
        { from: "users", to: "gw", routes: ["status"] },
        { from: "users", to: "lb", routes: ["connect"] },
        { from: "lb", to: "api", routes: ["connect"] },
        { from: "api", to: "sessions", routes: ["connect"] },
      ].filter(
        (e, i, all) =>
          all.findIndex((x) => x.from === e.from && x.to === e.to) === i,
      ),
    };
    const r = simulate(PRESENCE, bare);
    expect(type(r, "status", "baseline")?.availability).toBe(0);
    expect(scenario(r, "baseline").explanations).toContain(
      '"status" requests each go to many, but nothing sends them: route them through an app service, or a worker behind a queue, so none is served.',
    );
  });

  test("an app service batches only ID blocks; a worker never batches pushes", () => {
    const blocked = updateNode(CELLS, "api", {
      config: { nodes: 30, batch: 1_000, zones: 2, regions: 1 },
    });
    expect(node(simulate(NEARBY, blocked), "places", "baseline")?.loadRps).toBe(
      node(simulate(NEARBY, CELLS), "places", "baseline")?.loadRps,
    );
    const batchedPush = updateNode(LIVE, "fanners", {
      config: { nodes: 10, batch: 10, zones: 2, regions: 1 },
    });
    expect(
      node(simulate(PRESENCE, batchedPush), "gw", "baseline")?.loadRps,
    ).toBe(20_000);
  });

  test("a geo index with no replicas loses its lost zone's cells", () => {
    const lone = updateNode(CELLS, "places", {
      config: { shards: 8, replicas: 0, zones: 2, regions: 1 },
    });
    expect(scenario(simulate(NEARBY, lone), "zone").explanations).toContain(
      "places loses 50.0% of its data: it keeps one copy.",
    );
  });

  test("a coordinator's lost zone is in the region a lost region would take", () => {
    const split = updateNode(LEASES, "coord", {
      config: { members: 3, zones: 1, regions: 2 },
    });
    const region = HldProblem.parse({
      ...IDS,
      scenarios: [
        ...IDS.scenarios,
        {
          id: "region",
          name: "A region goes down",
          weight: 2,
          load: 1,
          failure: { scope: "region" },
          targets: { p99Ms: 100, availability: 0.99 },
        },
      ],
    });
    const r = simulate(region, split);
    expect(node(r, "coord", "zone")?.up).toBe(true);
    expect(node(r, "coord", "region")?.up).toBe(true);
  });

  test("batching takes hot writes off the partition, and a worker waits to fill a batch", () => {
    const r = simulate(VIEWS, TALLY);
    // 30,000 views in batches of 100: 300 writes a second.
    expect(node(r, "counts", "baseline")?.loadRps).toBe(300);
    expect(scenario(r, "baseline").targetsMet).toBe(true);
    // 150 views a second a node: 0.67 s to fill a batch of 100, at most 5 s.
    expect(node(r, "adders", "baseline")?.p99Ms).toBeGreaterThan(666);
    const slow = simulate(
      VIEWS,
      updateNode(TALLY, "adders", {
        config: { nodes: 200, batch: 1_000, zones: 2, regions: 1 },
      }),
    );
    expect(node(slow, "adders", "baseline")?.p99Ms).toBeGreaterThan(5_000);
    expect(node(slow, "adders", "baseline")?.p99Ms).toBeLessThan(5_100);
  });
});
