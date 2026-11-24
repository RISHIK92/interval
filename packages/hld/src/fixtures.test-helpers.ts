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
