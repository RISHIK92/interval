import { describe, expect, test } from "vitest";
import {
  COMPONENT_KINDS,
  Design,
  LATEST_SPEC,
  SPEC_V2_FROM,
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

describe("the spec sheet", () => {
  // ADR-0050 §6: v1.0 lists the 12 kinds of catalog v1; v2.0 adds the external
  // provider. The latest has every catalog kind.
  test("each version lists its kinds: 1.0 the first 12, 2.0 the external provider too", () => {
    expect(COMPONENT_KINDS).toHaveLength(13);
    expect(Object.keys(LATEST_SPEC.components).sort()).toEqual(
      [...COMPONENT_KINDS].sort(),
    );
    expect(Object.keys(specVersion("1.0")?.components ?? {}).sort()).toEqual(
      COMPONENT_KINDS.filter((k) => k !== "external_api").sort(),
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

  test("versions are found by name; each is PROVISIONAL with its notes", () => {
    expect(specVersion("1.0")?.version).toBe("1.0");
    expect(specVersion("2.0")).toBe(LATEST_SPEC);
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
});
