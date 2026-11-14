import { describe, expect, test } from "vitest";
import {
  COMPONENT_KINDS,
  CURRENT_SPEC,
  Design,
  SPEC_VERSIONS,
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

describe("the spec sheet", () => {
  test("every catalog component has stats in every version, and nothing else", () => {
    expect(COMPONENT_KINDS).toHaveLength(12);
    for (const spec of SPEC_VERSIONS)
      expect(Object.keys(spec.components).sort()).toEqual(
        [...COMPONENT_KINDS].sort(),
      );
  });

  test("numbers are sane: positive capacities, availabilities in (0, 1]", () => {
    for (const [kind, s] of Object.entries(CURRENT_SPEC.components)) {
      if (kind === "client") continue;
      expect(s.capacity, kind).toBeGreaterThan(0);
      expect(s.latencyMs, kind).toBeGreaterThan(0);
      expect(s.availability, kind).toBeGreaterThan(0.9);
      expect(s.availability, kind).toBeLessThanOrEqual(1);
    }
  });

  test("versions are found by name; v1.0 is PROVISIONAL with its notes", () => {
    expect(specVersion("1.0")).toBe(CURRENT_SPEC);
    expect(specVersion("9.9")).toBeNull();
    expect(CURRENT_SPEC.provisional).toBe(true);
    expect(CURRENT_SPEC.notes.length).toBeGreaterThan(0);
  });
});
