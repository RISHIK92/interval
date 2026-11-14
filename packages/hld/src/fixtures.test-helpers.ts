import type { Design } from "./design";
import { URL_SHORTENER } from "./practice";

// Shared by the engine's tests and its golden designs.
export const SHORTENER = URL_SHORTENER;

const edge = (from: string, to: string, ...routes: string[]) => ({
  from,
  to,
  routes,
});

// Sized for the spike and a zone's loss: two zones everywhere, a cache in front of a
// multi-zone database.
export const SOUND: Design = {
  version: 1,
  spec: "1.0",
  nodes: [
    { id: "users", kind: "client", config: {}, note: "" },
    {
      id: "lb",
      kind: "load_balancer",
      config: { zones: 2, regions: 1 },
      note: "",
    },
    {
      id: "api",
      kind: "app_service",
      config: { nodes: 40, zones: 2, regions: 1 },
      note: "",
    },
    {
      id: "cache",
      kind: "cache",
      config: { nodes: 4, memoryGbPerNode: 16, zones: 2, regions: 1 },
      note: "",
    },
    {
      id: "db",
      kind: "sql_db",
      config: {
        readReplicas: 2,
        storageGb: 2_000,
        failover: "multi_zone",
        regions: 1,
      },
      note: "",
    },
  ],
  edges: [
    edge("users", "lb", "read", "write"),
    edge("lb", "api", "read", "write"),
    edge("api", "cache", "read"),
    edge("api", "db", "read", "write"),
  ],
};

// One zone, no cache, too few app nodes: overloaded at baseline and down with its zone.
export const FRAGILE: Design = {
  version: 1,
  spec: "1.0",
  nodes: [
    { id: "users", kind: "client", config: {}, note: "" },
    {
      id: "lb",
      kind: "load_balancer",
      config: { zones: 1, regions: 1 },
      note: "",
    },
    {
      id: "api",
      kind: "app_service",
      config: { nodes: 6, zones: 1, regions: 1 },
      note: "",
    },
    {
      id: "db",
      kind: "sql_db",
      config: { readReplicas: 0, storageGb: 500, failover: "none", regions: 1 },
      note: "",
    },
  ],
  edges: [
    edge("users", "lb", "read", "write"),
    edge("lb", "api", "read", "write"),
    edge("api", "db", "read", "write"),
  ],
};

// Sound but lavish: far over budget.
export const LAVISH: Design = {
  ...SOUND,
  nodes: SOUND.nodes.map((n) =>
    n.kind === "app_service"
      ? { ...n, config: { ...n.config, nodes: 200, regions: 2 } }
      : n,
  ),
};
