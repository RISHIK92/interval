import { describe, expect, test } from "vitest";
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

// P6-W39 (CANVAS-1, CANVAS-2): the canvas's edits on a design.
const at = { x: 10, y: 20 };

describe("building a design", () => {
  test("the starter is a valid design with only the client", () => {
    const d = starterDesign();
    expect(check(d)).toEqual([]);
    expect(d.nodes.map((n) => n.kind)).toEqual(["client"]);
  });

  test("a new component gets a free id and the smallest valid config", () => {
    let d = addComponent(starterDesign(), "app_service", at);
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
    expect(configFields("sql_db")).toEqual([
      { name: "readReplicas", type: "int", min: 0, max: 15 },
      { name: "storageGb", type: "int", min: 10, max: 16_000 },
      {
        name: "failover",
        type: "choice",
        options: ["none", "standby", "multi_zone"],
      },
      { name: "regions", type: "int", min: 1, max: 2 },
    ]);
    expect(configFields("client")).toEqual([]);
  });

  test("a new edge carries every request type; narrowing to none removes it", () => {
    let d = addComponent(starterDesign(), "load_balancer", at);
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
    let d = addComponent(starterDesign(), "cache", at);
    d = connect(d, URL_SHORTENER, "users", "cache");
    d = removeNode(d, "cache");
    expect(d.nodes).toHaveLength(1);
    expect(d.edges).toEqual([]);
    expect(removeNode(d, "users")).toBe(d);
  });

  test("an invalid draft says where and why", () => {
    let d = addComponent(starterDesign(), "app_service", at);
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

test("every catalog field is an int or a choice, so the form shows real bounds", () => {
  for (const kind of COMPONENT_KINDS)
    for (const [name, schema] of Object.entries(CONFIG[kind].shape)) {
      const field = configFields(kind).find((f) => f.name === name);
      if (schema.type === "enum") expect(field?.type).toBe("choice");
      else {
        expect(schema.type).toBe("number");
        expect(
          Number.isInteger((schema as { minValue: number }).minValue),
        ).toBe(true);
        expect(
          Number.isInteger((schema as { maxValue: number }).maxValue),
        ).toBe(true);
      }
    }
});

test("a design for this problem uses only its components and request types", () => {
  let d = addComponent(starterDesign(), "queue", at);
  d = connect(d, URL_SHORTENER, "users", "queue");
  d = setRoutes(d, "users", "queue", ["read", "upload"]);
  expect(fitsProblem(d, URL_SHORTENER)).toEqual([
    "queue: this problem doesn't allow a queue",
    "users → queue: \"upload\" isn't one of this problem's requests",
  ]);
  expect(fitsProblem(starterDesign(), URL_SHORTENER)).toEqual([]);
});
