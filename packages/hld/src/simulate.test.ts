import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { Design } from "./design";
import { FRAGILE, LAVISH, SHORTENER, SOUND } from "./fixtures.test-helpers";
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
describe("golden designs", () => {
  for (const [name, design] of Object.entries({ SOUND, FRAGILE, LAVISH })) {
    test(`${name} gives its recorded result`, () => {
      const file = join(
        import.meta.dirname,
        "golden",
        `${name.toLowerCase()}.json`,
      );
      const got = JSON.parse(
        JSON.stringify(simulate(SHORTENER, design)),
      ) as unknown;
      if (process.env["UPDATE_GOLDEN"] === "1")
        writeFileSync(file, `${JSON.stringify(got, null, 2)}\n`);
      expect(got).toEqual(JSON.parse(readFileSync(file, "utf8")));
    });
  }
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
