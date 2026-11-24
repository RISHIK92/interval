import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  addComponent,
  check,
  configFields,
  connect,
  fitsProblem,
  removeNode,
  setRoutes,
  starterDesign,
  updateNode,
} from "./edit";
import { COMPONENT_KINDS, CONFIG } from "./catalog";
import { SHORTENER as URL_SHORTENER } from "./fixtures.test-helpers";
import { LATEST_SPEC, type SpecVersion, specVersion } from "./spec";

const V1 = specVersion("1.0") as SpecVersion;

// P6-W39 (CANVAS-1, CANVAS-2): the canvas's edits on a design.
const at = { x: 10, y: 20 };

describe("building a design", () => {
  test("the starter is a valid design with only the client", () => {
    const d = starterDesign("1.0");
    expect(check(d)).toEqual([]);
    expect(d.nodes.map((n) => n.kind)).toEqual(["client"]);
  });

  test("a new component gets a free id and the smallest valid config", () => {
    let d = addComponent(starterDesign("1.0"), "app_service", at);
    d = addComponent(d, "app_service", at);
    expect(d.nodes.slice(1).map((n) => n.id)).toEqual([
      "app-service",
      "app-service-2",
    ]);
    expect(d.nodes[1]?.config).toEqual({ nodes: 1, zones: 1, regions: 1 });
    expect(check(d)).toEqual([]);
    const db = addComponent(d, "sql_db", at).nodes.at(-1);
    expect(db?.config).toEqual({
      readReplicas: 0,
      storageGb: 10,
      failover: "none",
      regions: 1,
    });
  });

  test("config fields carry the catalog's bounds", () => {
    expect(configFields("sql_db", V1)).toEqual([
      {
        name: "readReplicas",
        label: "Read replicas",
        type: "int",
        min: 0,
        max: 15,
      },
      {
        name: "storageGb",
        label: "Storage (GB)",
        type: "int",
        min: 10,
        max: 16_000,
      },
      {
        name: "failover",
        label: "Failover",
        type: "choice",
        options: ["none", "standby", "multi_zone"],
      },
      { name: "regions", label: "Regions", type: "int", min: 1, max: 2 },
    ]);
    expect(configFields("client", V1)).toEqual([]);
  });

  test("a new edge carries every request type; narrowing to none removes it", () => {
    let d = addComponent(starterDesign("1.0"), "load_balancer", at);
    d = connect(d, URL_SHORTENER, "users", "load-balancer");
    expect(d.edges).toEqual([
      { from: "users", to: "load-balancer", routes: ["read", "write"] },
    ]);
    expect(connect(d, URL_SHORTENER, "users", "load-balancer")).toBe(d);
    d = setRoutes(d, "users", "load-balancer", ["read"]);
    expect(d.edges[0]?.routes).toEqual(["read"]);
    expect(setRoutes(d, "users", "load-balancer", []).edges).toEqual([]);
  });

  test("removing a component takes its edges; the client stays", () => {
    let d = addComponent(starterDesign("1.0"), "cache", at);
    d = connect(d, URL_SHORTENER, "users", "cache");
    d = removeNode(d, "cache");
    expect(d.nodes).toHaveLength(1);
    expect(d.edges).toEqual([]);
    expect(removeNode(d, "users")).toBe(d);
  });

  test("an invalid draft says where and why", () => {
    let d = addComponent(starterDesign("1.0"), "app_service", at);
    d = updateNode(d, "app-service", {
      config: { zones: 2 },
      note: "two zones",
    });
    d = addComponent(d, "cache", at);
    d = connect(d, URL_SHORTENER, "app-service", "cache");
    d = connect(d, URL_SHORTENER, "cache", "app-service");
    expect(d.nodes[1]?.note).toBe("two zones");
    expect(check(d)).toEqual([
      "app-service config: fewer nodes than zones",
      "the edges form a cycle",
    ]);
  });
});

test("every catalog field has a label for the form", () => {
  for (const kind of COMPONENT_KINDS)
    for (const f of configFields(kind, LATEST_SPEC))
      expect(f.label).not.toBe("");
});

test("every catalog field is an int or a choice, so the form shows real bounds", () => {
  // ADR-0053: the provider's pick is the problem's offer (providers.test.ts), not a
  // form field.
  for (const kind of COMPONENT_KINDS.filter((k) => k !== "external_api"))
    for (const [name, field_] of Object.entries(
      CONFIG[kind].shape as Record<string, z.ZodType>,
    )) {
      // An optional field (a setting newer than its kind) has the same bounds.
      const schema = field_ instanceof z.ZodOptional ? field_.unwrap() : field_;
      const field = configFields(kind, LATEST_SPEC).find(
        (f) => f.name === name,
      );
      if (schema instanceof z.ZodEnum) expect(field?.type).toBe("choice");
      else {
        expect(schema).toBeInstanceOf(z.ZodNumber);
        const int = schema as z.ZodNumber;
        expect(Number.isInteger(int.minValue)).toBe(true);
        expect(Number.isInteger(int.maxValue)).toBe(true);
      }
    }
});

test("a design for this problem uses only its components and request types", () => {
  let d = addComponent(starterDesign("1.0"), "queue", at);
  d = connect(d, URL_SHORTENER, "users", "queue");
  d = setRoutes(d, "users", "queue", ["read", "upload"]);
  expect(fitsProblem(d, URL_SHORTENER)).toEqual([
    "queue: this problem doesn't allow a queue",
    "users → queue: \"upload\" isn't one of this problem's requests",
  ]);
  expect(fitsProblem(starterDesign("1.0"), URL_SHORTENER)).toEqual([]);
});

// ADR-0050 §6: a design is drawn against one spec version, and gets only what it has.
describe("spec versions on the canvas", () => {
  test("a stream's retention is offered from 2.0 on, never to a 1.0 design", () => {
    const names = (spec: SpecVersion) =>
      configFields("stream", spec).map((f) => f.name);
    expect(names(V1)).not.toContain("retentionHours");
    expect(names(LATEST_SPEC)).toContain("retentionHours");
    expect(
      addComponent(starterDesign("1.0"), "stream", at).nodes[1]?.config,
    ).toEqual({ partitions: 1, replication: 1, zones: 1, regions: 1 });
    expect(
      addComponent(starterDesign("2.0"), "stream", at).nodes[1]?.config,
    ).toMatchObject({ retentionHours: 1 });
  });

  test("an external provider is a 2.0 kind: a 1.0 design with one is refused", () => {
    expect(
      check(addComponent(starterDesign("2.0"), "external_api", at)),
    ).toEqual([]);
    expect(
      check(addComponent(starterDesign("1.0"), "external_api", at)),
    ).toEqual(["external-api kind: spec 1.0 has no external api"]);
    expect(configFields("external_api", LATEST_SPEC)).toEqual([]);
  });

  test("a design for another spec version than its problem's doesn't fit it", () => {
    expect(fitsProblem(starterDesign("2.0"), URL_SHORTENER)).toEqual([
      "drawn against spec 2.0, but this problem uses spec 1.0",
    ]);
  });
});

// ADR-0050 stage 2: 2.1's kinds and the batch size reach the canvas from 2.1 on.
describe("spec 2.1 on the canvas", () => {
  const V2 = specVersion("2.0");
  if (V2 === null) throw new Error("no 2.0");

  test("a batch size is offered to app services and workers from 2.1, never before", () => {
    const names = (kind: "app_service" | "worker", spec: SpecVersion) =>
      configFields(kind, spec).map((f) => f.name);
    expect(names("worker", V2)).not.toContain("batch");
    expect(names("worker", LATEST_SPEC)).toContain("batch");
    expect(names("app_service", LATEST_SPEC)).toContain("batch");
    expect(
      addComponent(starterDesign("2.1"), "worker", at).nodes[1]?.config,
    ).toEqual({ nodes: 1, batch: 1, zones: 1, regions: 1 });
    expect(
      addComponent(starterDesign("2.0"), "worker", at).nodes[1]?.config,
    ).toEqual({ nodes: 1, zones: 1, regions: 1 });
  });

  test("2.1's kinds start at their smallest, and a 2.0 design with one is refused", () => {
    expect(
      addComponent(starterDesign("2.1"), "coordination", at).nodes[1]?.config,
    ).toEqual({ members: 3, zones: 1, regions: 1 });
    expect(
      addComponent(starterDesign("2.1"), "geo_index", at).nodes[1]?.config,
    ).toEqual({ shards: 1, replicas: 0, zones: 1, regions: 1 });
    for (const kind of [
      "geo_index",
      "connection_gateway",
      "coordination",
    ] as const) {
      expect(check(addComponent(starterDesign("2.1"), kind, at))).toEqual([]);
      expect(check(addComponent(starterDesign("2.0"), kind, at))).toHaveLength(
        1,
      );
    }
  });
});
