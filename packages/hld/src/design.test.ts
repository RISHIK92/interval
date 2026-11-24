import { describe, expect, test } from "vitest";
import {
  COMPONENT_KINDS,
  Design,
  LATEST_SPEC,
  SPEC_V2_FROM,
  SPEC_V21_FROM,
  SPEC_VERSIONS,
  specInEffect,
  specVersion,
} from "./index";

// P6-W36 (HLDQ-1, CANVAS-2, CANVAS-4; Q-P6-01): the design graph, the catalog, the
// spec sheet.
const shortener = {
  version: 1,
  spec: "1.0",
  nodes: [
    { id: "users", kind: "client", config: {} },
    {
      id: "lb",
      kind: "load_balancer",
      config: { zones: 2, regions: 1 },
      note: "Two zones so one can fail.",
    },
    {
      id: "api",
      kind: "app_service",
      config: { nodes: 4, zones: 2, regions: 1 },
    },
    {
      id: "cache",
      kind: "cache",
      config: { nodes: 2, memoryGbPerNode: 16, zones: 2, regions: 1 },
    },
    {
      id: "db",
      kind: "sql_db",
      config: {
        readReplicas: 2,
        storageGb: 500,
        failover: "multi_zone",
        regions: 1,
      },
    },
  ],
  edges: [
    { from: "users", to: "lb", routes: ["read", "write"] },
    { from: "lb", to: "api", routes: ["read", "write"] },
    { from: "api", to: "cache", routes: ["read"] },
    { from: "api", to: "db", routes: ["read", "write"] },
  ],
};

const issues = (design: unknown) =>
  Design.safeParse(design).error?.issues.map((i) => i.message) ?? [];

describe("the design graph", () => {
  test("a valid design parses, and a note defaults to empty", () => {
    const parsed = Design.parse(shortener);
    expect(parsed.nodes[0]?.note).toBe("");
    expect(parsed.nodes[1]?.note).toBe("Two zones so one can fail.");
  });

  test("one client, unique ids, edges between real nodes, nothing into the client", () => {
    expect(
      issues({
        ...shortener,
        nodes: shortener.nodes.filter((n) => n.kind !== "client"),
      }),
    ).toContain("a design has exactly one client");
    expect(
      issues({ ...shortener, nodes: [...shortener.nodes, shortener.nodes[2]] }),
    ).toContain("a node id used twice");
    expect(
      issues({
        ...shortener,
        edges: [
          ...shortener.edges,
          { from: "api", to: "ghost", routes: ["read"] },
        ],
      }),
    ).toContain("an edge to a node that isn't there");
    expect(
      issues({
        ...shortener,
        edges: [
          ...shortener.edges,
          { from: "api", to: "users", routes: ["read"] },
        ],
      }),
    ).toContain("nothing sends to the client");
    expect(
      issues({
        ...shortener,
        edges: [
          ...shortener.edges,
          { from: "api", to: "api", routes: ["read"] },
        ],
      }),
    ).toContain("an edge from a node to itself");
    expect(
      issues({ ...shortener, edges: [...shortener.edges, shortener.edges[0]] }),
    ).toContain("two edges between the same nodes");
  });

  test("each kind's config is held to its own bounds", () => {
    const withNode = (node: unknown) => ({
      ...shortener,
      nodes: [...shortener.nodes, node],
    });
    expect(
      Design.safeParse(
        withNode({
          id: "q",
          kind: "queue",
          config: { partitions: 0, retentionHours: 24, zones: 1, regions: 1 },
        }),
      ).success,
    ).toBe(false);
    expect(
      Design.safeParse(
        withNode({
          id: "q",
          kind: "queue",
          config: {
            partitions: 4,
            retentionHours: 24,
            zones: 1,
            regions: 1,
            extra: 1,
          },
        }),
      ).success,
    ).toBe(false);
    expect(
      Design.safeParse(withNode({ id: "x", kind: "mainframe", config: {} }))
        .success,
    ).toBe(false);
    expect(
      Design.safeParse(
        withNode({
          id: "q",
          kind: "queue",
          config: { partitions: 4, retentionHours: 24, zones: 1, regions: 1 },
          note: "x".repeat(281),
        }),
      ).success,
    ).toBe(false);
  });
});

// ADR-0050 [lag]: a stream's retention arrives with 2.0's backlog. A 2.0 stream must say
// how long a backlog may wait; a 1.0 stream never held one, so it can't say.
test("a stream's retention is required under 2.0 and refused under 1.0", () => {
  const withStream = (spec: string, config: Record<string, number>) => ({
    ...shortener,
    spec,
    nodes: [
      ...shortener.nodes,
      {
        id: "log",
        kind: "stream",
        config: {
          partitions: 2,
          replication: 3,
          zones: 1,
          regions: 1,
          ...config,
        },
      },
    ],
  });
  expect(issues(withStream("1.0", {}))).toEqual([]);
  expect(issues(withStream("1.0", { retentionHours: 24 }))).toEqual([
    "spec 1.0 has no retentionHours",
  ]);
  expect(issues(withStream("2.0", { retentionHours: 24 }))).toEqual([]);
  expect(issues(withStream("2.0", {}))).toEqual([
    "retentionHours is required under spec 2.0",
  ]);
});

// ADR-0050 [batch]: an app service's or worker's batch size arrives with 2.1. A 2.1
// design says it (1 for none), a 2.0 or 1.0 one can't; 2.1's kinds are refused before it.
test("a batch size is required under 2.1 and refused before it; 2.1's kinds need 2.1", () => {
  const withApi = (spec: string, config: Record<string, number>) => ({
    ...shortener,
    spec,
    nodes: shortener.nodes.map((n) =>
      n.id === "api" ? { ...n, config: { ...n.config, ...config } } : n,
    ),
  });
  expect(issues(withApi("2.0", {}))).toEqual([]);
  expect(issues(withApi("2.0", { batch: 10 }))).toEqual([
    "spec 2.0 has no batch",
  ]);
  expect(issues(withApi("2.1", { batch: 10 }))).toEqual([]);
  expect(issues(withApi("2.1", {}))).toEqual([
    "batch is required under spec 2.1",
  ]);
  const coord = (spec: string, members: number) => ({
    ...withApi(spec, spec === "2.1" ? { batch: 1 } : {}),
    nodes: [
      ...withApi(spec, spec === "2.1" ? { batch: 1 } : {}).nodes,
      {
        id: "leases",
        kind: "coordination",
        config: { members, zones: 3, regions: 1 },
      },
    ],
  });
  expect(issues(coord("2.1", 5))).toEqual([]);
  expect(issues(coord("2.1", 4))).toEqual(["3, 5 or 7 members"]);
  expect(issues(coord("2.0", 3))).toEqual(["spec 2.0 has no coordination"]);
});

describe("the spec sheet", () => {
  // ADR-0050 §6: v1.0 lists the 12 kinds of catalog v1; v2.0 adds the external
  // provider. The latest has every catalog kind.
  test("each version lists its kinds: 1.0 the first 12, 2.0 the external provider too, 2.1 three more", () => {
    const V21 = ["geo_index", "connection_gateway", "coordination"];
    expect(COMPONENT_KINDS).toHaveLength(16);
    expect(Object.keys(LATEST_SPEC.components).sort()).toEqual(
      [...COMPONENT_KINDS].sort(),
    );
    expect(Object.keys(specVersion("2.0")?.components ?? {}).sort()).toEqual(
      COMPONENT_KINDS.filter((k) => !V21.includes(k)).sort(),
    );
    expect(Object.keys(specVersion("1.0")?.components ?? {}).sort()).toEqual(
      COMPONENT_KINDS.filter(
        (k) => k !== "external_api" && !V21.includes(k),
      ).sort(),
    );
  });

  test("numbers are sane: positive capacities, availabilities in (0, 1]", () => {
    for (const spec of SPEC_VERSIONS)
      for (const [kind, s] of Object.entries(spec.components)) {
        // The client is the traffic; a provider's capacity is its problem's.
        if (kind === "client" || s.setByProblem !== undefined) continue;
        expect(s.capacity, kind).toBeGreaterThan(0);
        expect(s.latencyMs, kind).toBeGreaterThan(0);
        expect(s.availability, kind).toBeGreaterThan(0.9);
        expect(s.availability, kind).toBeLessThanOrEqual(1);
      }
  });

  test("2.0 changes no 1.0 number: it only adds a kind, bandwidth and features", () => {
    const v1 = specVersion("1.0");
    expect(v1?.features).toEqual({});
    expect(LATEST_SPEC.engine).toEqual(v1?.engine);
    for (const [kind, s] of Object.entries(v1?.components ?? {})) {
      const latest =
        LATEST_SPEC.components[kind as keyof typeof LATEST_SPEC.components];
      expect({ ...latest, bandwidthMbps: undefined }, kind).toEqual({
        ...s,
        bandwidthMbps: undefined,
      });
    }
  });

  // ADR-0050 stage 2: 2.1 only adds; every 2.0 number and feature is 2.1's too.
  test("2.1 changes no 2.0 number: it only adds kinds and features", () => {
    const v2 = specVersion("2.0");
    const v21 = specVersion("2.1");
    expect(v21).toBe(LATEST_SPEC);
    expect(v21?.engine).toEqual(v2?.engine);
    for (const [kind, s] of Object.entries(v2?.components ?? {}))
      expect(
        v21?.components[kind as keyof typeof LATEST_SPEC.components],
        kind,
      ).toEqual(s);
    expect(v21?.features).toMatchObject(v2?.features ?? {});
    expect(v21?.features).toMatchObject({
      geo: { cellsPerQuery: 3 },
      gateway: { reconnectWindowSeconds: 30 },
      coordination: { storageGb: 8, crossZoneMs: 2, crossRegionMs: 70 },
      fanout: { parallelism: 50 },
      hot: true,
      batch: { maxWaitSeconds: 5 },
    });
  });

  test("versions are found by name; each is PROVISIONAL with its notes", () => {
    expect(specVersion("1.0")?.version).toBe("1.0");
    expect(specVersion("2.0")?.version).toBe("2.0");
    expect(specVersion("2.1")).toBe(LATEST_SPEC);
    expect(specVersion("9.9")).toBeNull();
    for (const spec of SPEC_VERSIONS) {
      expect(spec.provisional).toBe(true);
      expect(spec.notes.length).toBeGreaterThan(0);
    }
  });

  // Q-WD-31: a version takes effect at a monthly season boundary (UTC).
  test("2.0 is in effect from the first of December, not a moment before", () => {
    expect(SPEC_V2_FROM).toBe("2026-12-01");
    expect(specInEffect("2.0", new Date("2026-11-30T23:59:59Z"))).toBe(false);
    expect(specInEffect("2.0", new Date("2026-12-01T00:00:00Z"))).toBe(true);
    expect(specInEffect("1.0", new Date("2026-11-30T23:59:59Z"))).toBe(true);
    expect(specInEffect("9.9", new Date("2030-01-01T00:00:00Z"))).toBe(false);
  });

  // Q-WD-31: v2.1 at the next monthly boundary, a month after v2.0's.
  test("2.1 is in effect from the first of January 2027, not a moment before", () => {
    expect(SPEC_V21_FROM).toBe("2027-01-01");
    expect(specInEffect("2.1", new Date("2026-12-31T23:59:59Z"))).toBe(false);
    expect(specInEffect("2.1", new Date("2027-01-01T00:00:00Z"))).toBe(true);
    expect(specInEffect("2.0", new Date("2026-12-31T23:59:59Z"))).toBe(true);
  });
});
