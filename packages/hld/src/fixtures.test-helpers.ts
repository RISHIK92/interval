import type { Design } from "./design";
import { HldProblem } from "./problem";

// A URL shortener: reads (redirects) dominate and are cacheable; writes (new links)
// are not. Hand-written, so the engine's tests and golden designs never move with
// the families.
export const SHORTENER = HldProblem.parse({
  slug: "url-shortener",
  title: "URL shortener",
  spec: "1.0",
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

// ADR-0050 stage 1 (spec 2.0): one-time code sign-in, hand-written as SHORTENER is. Codes
// go out through an SMS provider that allows 400 sends a second at $0.0001 each, and
// must arrive within 15 minutes; the provider goes down for 10.
export const SIGN_IN = HldProblem.parse({
  slug: "sign-in",
  title: "One-time code sign-in",
  spec: "2.0",
  timeLimitMinutes: 30,
  requirements: ["Send a code", "Check a code", "Check a session"],
  traffic: {
    requests: [
      { type: "session", rps: 800, kind: "read", cacheable: false },
      {
        type: "send_code",
        rps: 80,
        kind: "write",
        cacheable: false,
        completionSeconds: 900,
        requires: ["external_api"],
      },
      { type: "verify", rps: 120, kind: "write", cacheable: false },
    ],
    workingSetGb: 5,
    hotKeySkew: 0.5,
    storedGb: 10,
    growthGbPerDay: 0.1,
    horizonDays: 30,
    providerRps: 400,
    providerCostPerCall: 0.0001,
  },
  budgetPerMonth: 40_000,
  scenarios: [
    {
      id: "baseline",
      name: "A normal day",
      weight: 3,
      load: 1,
      targets: { p99Ms: 400, availability: 0.999 },
    },
    {
      id: "peak",
      name: "A spike",
      weight: 2,
      load: 3,
      targets: { p99Ms: 800, availability: 0.995 },
    },
    {
      id: "provider_down",
      name: "The SMS provider is down for 10 minutes",
      weight: 2,
      load: 1,
      minutes: 10,
      failure: { scope: "node", kind: "external_api" },
      targets: { p99Ms: 600, availability: 0.99 },
    },
  ],
  allowedComponents: [
    "load_balancer",
    "app_service",
    "kv_store",
    "queue",
    "worker",
    "external_api",
  ],
  rubric: [
    { id: "async", criterion: "Sends codes off the request.", weight: 1 },
  ],
  concepts: ["queues", "third parties"],
});

// The codes queued: a worker calls the provider, so its outage only delays them.
export const QUEUED: Design = {
  version: 1,
  spec: "2.0",
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
      config: { nodes: 6, zones: 2, regions: 1 },
      note: "",
    },
    {
      id: "codes",
      kind: "kv_store",
      config: { nodes: 2, replication: 3, zones: 2, regions: 1 },
      note: "",
    },
    {
      id: "q",
      kind: "queue",
      config: { partitions: 2, retentionHours: 24, zones: 2, regions: 1 },
      note: "",
    },
    {
      id: "senders",
      kind: "worker",
      config: { nodes: 4, zones: 2, regions: 1 },
      note: "",
    },
    { id: "sms", kind: "external_api", config: {}, note: "" },
  ],
  edges: [
    edge("users", "lb", "session", "send_code", "verify"),
    edge("lb", "api", "session", "send_code", "verify"),
    edge("api", "codes", "session", "send_code", "verify"),
    edge("api", "q", "send_code"),
    edge("q", "senders", "send_code"),
    edge("senders", "sms", "send_code"),
  ],
};

// The provider called inside the request: its outage fails sign-in.
export const DIRECT: Design = {
  ...QUEUED,
  nodes: QUEUED.nodes.filter((n) => n.id !== "q" && n.id !== "senders"),
  edges: [
    ...QUEUED.edges.filter(
      (e) => e.from !== "q" && e.to !== "q" && e.from !== "senders",
    ),
    edge("api", "sms", "send_code"),
  ],
};

// ADR-0050 stage 1 (spec 2.0): video uploads and views. Each upload is 2 MB, and its
// transcode costs a worker 300 jobs' worth, done within 30 minutes; a view is 500 KB.
export const CLIPS = HldProblem.parse({
  slug: "clips",
  title: "Short video clips",
  spec: "2.0",
  timeLimitMinutes: 30,
  requirements: ["Upload a clip", "Watch a clip"],
  traffic: {
    requests: [
      {
        type: "view",
        rps: 2_000,
        kind: "read",
        cacheable: true,
        payloadKb: 500,
      },
      {
        type: "upload",
        rps: 20,
        kind: "write",
        cacheable: false,
        payloadKb: 2_000,
        work: 300,
        completionSeconds: 1_800,
        requires: ["worker"],
      },
    ],
    workingSetGb: 50,
    hotKeySkew: 0.8,
    storedGb: 1_000,
    growthGbPerDay: 10,
    horizonDays: 90,
  },
  budgetPerMonth: 120_000,
  scenarios: [
    {
      id: "baseline",
      name: "A normal day",
      weight: 3,
      load: 1,
      targets: { p99Ms: 300, availability: 0.999 },
    },
    {
      id: "uploads",
      name: "Two hours of three times the uploads",
      weight: 2,
      load: 1,
      minutes: 120,
      loads: { upload: 3 },
      targets: { p99Ms: 600, availability: 0.995 },
    },
  ],
  allowedComponents: [
    "cdn",
    "load_balancer",
    "app_service",
    "object_storage",
    "queue",
    "worker",
  ],
  rubric: [{ id: "cdn", criterion: "Serves views from a CDN.", weight: 1 }],
  concepts: ["CDN", "transcoding"],
});

// Views from a CDN in front of object storage; uploads through the app to storage and a
// transcoding queue.
export const STUDIO: Design = {
  version: 1,
  spec: "2.0",
  nodes: [
    { id: "users", kind: "client", config: {}, note: "" },
    { id: "edge", kind: "cdn", config: { ttlSeconds: 3_600 }, note: "" },
    {
      id: "lb",
      kind: "load_balancer",
      config: { zones: 2, regions: 1 },
      note: "",
    },
    {
      id: "api",
      kind: "app_service",
      config: { nodes: 4, zones: 2, regions: 1 },
      note: "",
    },
    { id: "files", kind: "object_storage", config: { regions: 1 }, note: "" },
    {
      id: "jobs",
      kind: "queue",
      config: { partitions: 2, retentionHours: 24, zones: 2, regions: 1 },
      note: "",
    },
    {
      id: "transcoders",
      kind: "worker",
      config: { nodes: 40, zones: 2, regions: 1 },
      note: "",
    },
  ],
  edges: [
    edge("users", "edge", "view"),
    edge("edge", "files", "view"),
    edge("users", "lb", "upload"),
    edge("lb", "api", "upload"),
    edge("api", "files", "upload"),
    edge("api", "jobs", "upload"),
    edge("jobs", "transcoders", "upload"),
    edge("transcoders", "files", "upload"),
  ],
};

// ADR-0050 stage 2 (spec 2.1), hand-written as the 2.0 ones are. Shared 2.1 scenarios: a
// normal day, a spike and a zone's loss.
const v21Scenarios = (p99Ms: number) => [
  {
    id: "baseline",
    name: "A normal day",
    weight: 3,
    load: 1,
    targets: { p99Ms, availability: 0.999 },
  },
  {
    id: "peak",
    name: "A spike",
    weight: 2,
    load: 3,
    targets: { p99Ms: p99Ms * 2, availability: 0.995 },
  },
  {
    id: "zone",
    name: "A zone goes down",
    weight: 2,
    load: 1,
    failure: { scope: "zone" as const },
    targets: { p99Ms: p99Ms * 1.5, availability: 0.99 },
  },
];
const lb2 = {
  id: "lb",
  kind: "load_balancer" as const,
  config: { zones: 2, regions: 1 },
  note: "",
};
const api21 = (nodes: number, batch = 1) => ({
  id: "api",
  kind: "app_service" as const,
  config: { nodes, batch, zones: 2, regions: 1 },
  note: "",
});

// Nearby places: 8,000 nearby queries and 2,000 position updates a second.
export const NEARBY = HldProblem.parse({
  slug: "nearby",
  title: "Nearby places",
  spec: "2.1",
  timeLimitMinutes: 30,
  requirements: ["Find nearby places", "Move a place"],
  traffic: {
    requests: [
      { type: "nearby", rps: 8_000, kind: "read", cacheable: false },
      { type: "move", rps: 2_000, kind: "write", cacheable: false },
    ],
    workingSetGb: 10,
    hotKeySkew: 0.3,
    storedGb: 0,
    growthGbPerDay: 0,
    horizonDays: 30,
  },
  budgetPerMonth: 20_000,
  scenarios: v21Scenarios(100),
  allowedComponents: ["load_balancer", "app_service", "geo_index"],
  rubric: [{ id: "cells", criterion: "Maps a radius to cells.", weight: 1 }],
  concepts: ["geo index"],
});

// A geo index of 8 shards with one replica each.
export const CELLS: Design = {
  version: 1,
  spec: "2.1",
  nodes: [
    { id: "users", kind: "client", config: {}, note: "" },
    lb2,
    api21(30),
    {
      id: "places",
      kind: "geo_index",
      config: { shards: 8, replicas: 1, zones: 2, regions: 1 },
      note: "",
    },
  ],
  edges: [
    edge("users", "lb", "nearby", "move"),
    edge("lb", "api", "nearby", "move"),
    edge("api", "places", "nearby", "move"),
  ],
};

// Presence: 400,000 connected clients. A status change is pushed to its 20 contacts on
// average (500 at the 99th percentile) through a stream, workers and the gateway.
export const PRESENCE = HldProblem.parse({
  slug: "presence",
  title: "Online presence",
  spec: "2.1",
  timeLimitMinutes: 30,
  requirements: ["Push a status change", "Check a session on connect"],
  traffic: {
    requests: [
      { type: "connect", rps: 200, kind: "read", cacheable: false },
      {
        type: "status",
        rps: 1_000,
        kind: "write",
        cacheable: false,
        completionSeconds: 60,
        push: true,
        fanout: { mean: 20, p99: 500 },
        requires: ["connection_gateway"],
      },
    ],
    workingSetGb: 5,
    hotKeySkew: 0.5,
    storedGb: 5,
    growthGbPerDay: 0.1,
    horizonDays: 30,
    connections: 400_000,
  },
  budgetPerMonth: 30_000,
  scenarios: [
    ...v21Scenarios(200),
    {
      id: "gateway_node",
      name: "A gateway node dies",
      weight: 2,
      load: 1,
      failure: { scope: "node", kind: "connection_gateway" },
      targets: { p99Ms: 300, availability: 0.99 },
    },
  ],
  allowedComponents: [
    "load_balancer",
    "app_service",
    "kv_store",
    "stream",
    "worker",
    "connection_gateway",
  ],
  rubric: [{ id: "offline", criterion: "Decides offline.", weight: 1 }],
  concepts: ["persistent connections", "fan-out"],
});

export const LIVE: Design = {
  version: 1,
  spec: "2.1",
  nodes: [
    { id: "users", kind: "client", config: {}, note: "" },
    lb2,
    api21(6),
    {
      id: "sessions",
      kind: "kv_store",
      config: { nodes: 3, replication: 3, zones: 2, regions: 1 },
      note: "",
    },
    {
      id: "changes",
      kind: "stream",
      config: {
        partitions: 4,
        replication: 3,
        retentionHours: 24,
        zones: 2,
        regions: 1,
      },
      note: "",
    },
    {
      id: "fanners",
      kind: "worker",
      config: { nodes: 10, batch: 1, zones: 2, regions: 1 },
      note: "",
    },
    {
      id: "gw",
      kind: "connection_gateway",
      config: { nodes: 10, zones: 2, regions: 1 },
      note: "",
    },
  ],
  edges: [
    edge("users", "lb", "connect", "status"),
    edge("lb", "api", "connect", "status"),
    edge("api", "sessions", "connect", "status"),
    edge("api", "changes", "status"),
    edge("changes", "fanners", "status"),
    edge("fanners", "gw", "status"),
  ],
};

// Unique IDs: 20,000 a second, leased in blocks from a coordination service.
export const IDS = HldProblem.parse({
  slug: "ids",
  title: "Unique IDs",
  spec: "2.1",
  timeLimitMinutes: 30,
  requirements: ["Hand out a unique ID"],
  traffic: {
    requests: [
      {
        type: "next_id",
        rps: 20_000,
        kind: "write",
        cacheable: false,
        requires: ["coordination"],
      },
    ],
    workingSetGb: 1,
    hotKeySkew: 0,
    storedGb: 1,
    growthGbPerDay: 0,
    horizonDays: 30,
  },
  budgetPerMonth: 10_000,
  scenarios: v21Scenarios(50),
  allowedComponents: ["load_balancer", "app_service", "coordination"],
  rubric: [
    { id: "gaps", criterion: "Says what a lost block costs.", weight: 1 },
  ],
  concepts: ["consensus"],
});

// Blocks of 1,000 IDs per app node, from 3 members in 3 zones.
export const LEASES: Design = {
  version: 1,
  spec: "2.1",
  nodes: [
    { id: "users", kind: "client", config: {}, note: "" },
    lb2,
    api21(40, 1_000),
    {
      id: "coord",
      kind: "coordination",
      config: { members: 3, zones: 3, regions: 1 },
      note: "",
    },
  ],
  edges: [
    edge("users", "lb", "next_id"),
    edge("lb", "api", "next_id"),
    edge("api", "coord", "next_id"),
  ],
};

// View counts: 30,000 views a second, 80% of them on one viral post.
export const VIEWS = HldProblem.parse({
  slug: "views",
  title: "View counts",
  spec: "2.1",
  timeLimitMinutes: 30,
  requirements: ["Count a view"],
  traffic: {
    requests: [
      {
        type: "view",
        rps: 30_000,
        kind: "write",
        cacheable: false,
        completionSeconds: 60,
        hotShare: 0.8,
      },
    ],
    workingSetGb: 10,
    hotKeySkew: 0.5,
    storedGb: 10,
    growthGbPerDay: 1,
    horizonDays: 30,
  },
  budgetPerMonth: 40_000,
  scenarios: v21Scenarios(100),
  allowedComponents: [
    "load_balancer",
    "app_service",
    "kv_store",
    "stream",
    "worker",
  ],
  rubric: [{ id: "lag", criterion: "Says how far behind.", weight: 1 }],
  concepts: ["hot partitions", "batching"],
});

// Views into a stream; workers add them up in batches of 100 into the counters.
export const TALLY: Design = {
  version: 1,
  spec: "2.1",
  nodes: [
    { id: "users", kind: "client", config: {}, note: "" },
    lb2,
    api21(50),
    {
      id: "events",
      kind: "stream",
      config: {
        partitions: 4,
        replication: 3,
        retentionHours: 24,
        zones: 2,
        regions: 1,
      },
      note: "",
    },
    {
      id: "adders",
      kind: "worker",
      config: { nodes: 200, batch: 100, zones: 2, regions: 1 },
      note: "",
    },
    {
      id: "counts",
      kind: "kv_store",
      config: { nodes: 4, replication: 3, zones: 2, regions: 1 },
      note: "",
    },
  ],
  edges: [
    edge("users", "lb", "view"),
    edge("lb", "api", "view"),
    edge("api", "events", "view"),
    edge("events", "adders", "view"),
    edge("adders", "counts", "view"),
  ],
};
