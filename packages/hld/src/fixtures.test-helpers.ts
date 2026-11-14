import type { Design } from "./design";
import { HldProblem } from "./problem";

// A URL shortener: reads (redirects) dominate and are cacheable; writes (new links)
// are not. Hand-written, so the engine's tests and golden designs never move with
// the families.
export const SHORTENER = HldProblem.parse({
  slug: "url-shortener",
  title: "URL shortener",
  timeLimitMinutes: 30,
  requirements: ["Shorten a URL", "Redirect a short code to its URL"],
  traffic: {
    requests: [
      { type: "read", rps: 8_000, kind: "read", cacheable: true },
      { type: "write", rps: 400, kind: "write", cacheable: false },
    ],
    workingSetGb: 40,
    hotKeySkew: 0.8,
    storedGb: 200,
    growthGbPerDay: 2,
    horizonDays: 365,
  },
  budgetPerMonth: 6_000,
  scenarios: [
    {
      id: "baseline",
      name: "A normal day",
      weight: 3,
      load: 1,
      targets: { p99Ms: 100, availability: 0.999 },
    },
    {
      id: "peak",
      name: "A launch-day spike",
      weight: 2,
      load: 3,
      targets: { p99Ms: 200, availability: 0.995 },
    },
    {
      id: "zone",
      name: "A zone goes down",
      weight: 2,
      load: 1,
      failure: { scope: "zone" },
      targets: { p99Ms: 150, availability: 0.99 },
    },
  ],
  allowedComponents: [
    "load_balancer",
    "app_service",
    "cache",
    "sql_db",
    "kv_store",
    "cdn",
  ],
  rubric: [
    {
      id: "caching",
      criterion: "Caches redirects and explains its invalidation.",
      weight: 1,
    },
  ],
  concepts: ["caching", "replication"],
});

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
