import type { ComponentKind } from "./catalog";

// P6-W36 (CANVAS-4; Q-P6-01): the public spec sheet, versioned. Every simulation is
// run against one version; numbers change only at season boundaries, with patch notes,
// like a competitive game's balance patches. v1.0's numbers are PROVISIONAL: Claude
// drafted them from typical real-world figures, for the owner to review before launch.

export type ComponentStats = {
  name: string;
  summary: string;
  // What one node handles per second at full use, in `unit`s; for a relational
  // database, reads (its writes go to the primary only, at `writeCapacity`).
  capacity: number;
  unit: string;
  writeCapacity?: number;
  // A request's time through the node when it isn't busy (queueing adds to it, W37).
  latencyMs: number;
  writeLatencyMs?: number;
  // The share of time one node is up; a zone or region failure takes all of its
  // nodes there (W37 models both by placement and failover).
  availability: number;
  costPerNodeHour: number; // USD
  // ADR-0050 [bytes]: what one node moves a second, in megabits; under version 2.0 its
  // utilization is the larger of requests and bytes against capacity.
  bandwidthMbps?: number;
  // Q-WD-31: numbers each problem sets in place of the sheet's (a provider's rate
  // limit and price per call), in words for the sheet.
  setByProblem?: string;
};

// The simulator's own constants: part of the versioned spec, so a change to one is a
// balance patch with its notes, never a silent change to scores (CANVAS-4).
export type EngineConstants = {
  hoursPerMonth: number;
  cdnContentChangeSeconds: number; // how often cacheable content changes, against a CDN's TTL
  maxCdnHitRate: number;
  maxCacheHitRate: number;
  cdnPointsOfPresence: number; // a CDN's servers: it never runs short in practice
  cacheMemoryCostPerGbHour: number; // USD, on top of a cache node's cost
  storageCostPerGbMonth: number; // USD, a relational database's provisioned storage
  kvStorageGbPerNode: number; // what one key-value node holds (replicas are copies)
  objectStoragePerGbMonth: number; // USD, billed on what's kept
};

// ADR-0050 §6: the engine's behaviours new since 1.0, each switched on by the version a
// design was drawn against (never by comparing version strings), with the constants
// it alone uses. A version without one simulates exactly as 1.0 did, for ever, since
// replays, disputes and appeals re-run old designs.
export type Features = {
  // [lag]: a queue or stream builds a backlog its consumers drain later, instead of
  // failing a spike or an outage beyond it; scenarios last `minutes`.
  lag?: { defaultScenarioMinutes: number };
  work?: true; // [work]: a request type's work units at a worker
  // [bytes]: payload bandwidth on the nodes that carry it, and egress billed per GB.
  bytes?: { cdnEgressPerGb: number; originEgressPerGb: number };
  // With the external provider: a request type its outage cuts off fails at once,
  // costing availability, not an unbounded p99 (a card network's outage refuses
  // payments; it doesn't hang them).
  failFast?: true;
  // ADR-0051: a request type names what must do its work (a provider, a worker); a path
  // that never reaches one doesn't serve the type.
  requires?: true;
};

export type SpecVersion = {
  version: string;
  date: string; // ISO day it took effect: a season boundary (CANVAS-4)
  provisional: boolean;
  // The kinds this version has: a design using any other is refused.
  components: Partial<Record<ComponentKind, ComponentStats>>;
  features: Features;
  notes: string[]; // the patch notes: what changed from the version before
  engine: EngineConstants;
};

const V1_0 = {
  version: "1.0",
  date: "2026-11-14",
  provisional: true,
  features: {},
  notes: [
    "The first spec sheet: 12 components with their capacity, latency, availability and cost.",
  ],
  engine: {
    hoursPerMonth: 730,
    cdnContentChangeSeconds: 600,
    maxCdnHitRate: 0.95,
    maxCacheHitRate: 0.99,
    cdnPointsOfPresence: 20,
    cacheMemoryCostPerGbHour: 0.005,
    storageCostPerGbMonth: 0.115,
    kvStorageGbPerNode: 1_000,
    objectStoragePerGbMonth: 0.023,
  },
  components: {
    client: {
      name: "Client",
      summary:
        "The problem's users: where its traffic starts. Exactly one per design.",
      capacity: 0,
      unit: "requests/s",
      latencyMs: 0,
      availability: 1,
      costPerNodeHour: 0,
    },
    cdn: {
      name: "CDN",
      summary:
        "Serves cacheable responses from the edge; misses go to its origin. Its hit rate follows the TTL against how often content changes.",
      capacity: 100_000,
      unit: "requests/s per point of presence",
      latencyMs: 15,
      availability: 0.9999,
      costPerNodeHour: 0.08,
    },
    load_balancer: {
      name: "Load balancer",
      summary:
        "Spreads requests across the nodes behind it, in every zone it spans.",
      capacity: 50_000,
      unit: "requests/s",
      latencyMs: 1,
      availability: 0.9999,
      costPerNodeHour: 0.025,
    },
    app_service: {
      name: "App service",
      summary: "Stateless application servers. Scale by adding nodes.",
      capacity: 1_000,
      unit: "requests/s per node",
      latencyMs: 20,
      availability: 0.999,
      costPerNodeHour: 0.1,
    },
    cache: {
      name: "Cache",
      summary:
        "An in-memory key-value cache. Its hit rate follows its memory against the problem's working set and hot-key skew.",
      capacity: 100_000,
      unit: "operations/s per node",
      latencyMs: 1,
      availability: 0.999,
      costPerNodeHour: 0.2,
    },
    sql_db: {
      name: "Relational database",
      summary:
        "A primary that takes every write, and read replicas. Failover decides what a primary's or zone's failure costs.",
      capacity: 10_000,
      unit: "reads/s per instance",
      writeCapacity: 2_000,
      latencyMs: 5,
      writeLatencyMs: 10,
      availability: 0.999,
      costPerNodeHour: 0.5,
    },
    kv_store: {
      name: "Key-value store",
      summary:
        "A partitioned NoSQL store that scales by nodes; replication keeps data through node failures.",
      capacity: 20_000,
      unit: "operations/s per node",
      latencyMs: 3,
      availability: 0.999,
      costPerNodeHour: 0.25,
    },
    queue: {
      name: "Message queue",
      summary:
        "Decouples producers from consumers; it absorbs bursts the workers then drain.",
      capacity: 10_000,
      unit: "messages/s per partition",
      latencyMs: 5,
      availability: 0.9995,
      costPerNodeHour: 0.05,
    },
    worker: {
      name: "Worker service",
      summary: "Background workers that consume a queue or stream.",
      capacity: 200,
      unit: "jobs/s per node",
      latencyMs: 50,
      availability: 0.999,
      costPerNodeHour: 0.1,
    },
    object_storage: {
      name: "Object storage",
      summary:
        "Durable storage for files and blobs, effectively unlimited; slower than a database.",
      capacity: 100_000,
      unit: "requests/s",
      latencyMs: 50,
      availability: 0.9999,
      costPerNodeHour: 0.03,
    },
    search_index: {
      name: "Search index",
      summary:
        "Full-text and filtered search. Shards spread the data; replicas add read capacity and survive failures.",
      capacity: 2_000,
      unit: "queries/s per shard replica",
      latencyMs: 30,
      availability: 0.999,
      costPerNodeHour: 0.3,
    },
    stream: {
      name: "Stream processor",
      summary:
        "An ordered, replayable log (Kafka-like), read by consumers at their own pace.",
      capacity: 50_000,
      unit: "events/s per partition",
      latencyMs: 10,
      availability: 0.9995,
      costPerNodeHour: 0.08,
    },
  },
} satisfies SpecVersion;

// Q-WD-31: an HLD season is monthly, and v2.0 takes effect at the first boundary after
// ADR-0050 was accepted. Before it, no match or practice problem is drawn on 2.0.
export const SPEC_V2_FROM = "2026-12-01";

// ADR-0050 stage 1 (§5, PROVISIONAL like 1.0): the external provider, backlog and lag,
// work units, and payload bandwidth with egress. Every 1.0 number is unchanged.
const V2_0: SpecVersion = {
  version: "2.0",
  date: SPEC_V2_FROM,
  provisional: true,
  features: {
    lag: { defaultScenarioMinutes: 15 },
    work: true,
    bytes: { cdnEgressPerGb: 0.02, originEgressPerGb: 0.09 },
    failFast: true,
    requires: true,
  },
  notes: [
    "New component: the external provider, a third party (card network, SMS, customers' endpoints, the open web) at the problem's rate limit and price per call. It can't be scaled, and it can go down. Used by one-time code sign-in, webhook delivery, payment processing and the web crawler.",
    "Queues and streams now hold a backlog: when their consumers fall behind, or the provider behind them is down, work waits and drains afterwards. It counts as served when it's done within the request's completion target and the queue's retention; streams gain a retention setting. Used by one-time code sign-in, webhook delivery, payment processing, the web crawler, image resizing and video streaming.",
    "Work units: a job can cost a worker many times a simple one (a transcode against a counter). Used by image resizing, video streaming and the web crawler.",
    "Bytes: requests carry a payload. App services (1,000 Mbps a node) and load balancers (10,000 Mbps) fill on bytes as well as requests, and bytes served are billed: $0.02 a GB from a CDN, $0.09 from anything else. Used by image resizing, video streaming and file sync.",
    "A request type an outage cuts off (the provider is down) now fails at once: it counts against what's served, not as an unbounded p99.",
    "A request type says what must do its work: a code isn't sent until it reaches the SMS provider, and an upload isn't transcoded until it reaches a worker. A design that leaves that out serves none of it, however cheap.",
    "Every version 1.0 number is unchanged, and so is every 1.0 family's result: they stay on 1.0.",
  ],
  engine: V1_0.engine,
  components: {
    ...V1_0.components,
    load_balancer: { ...V1_0.components.load_balancer, bandwidthMbps: 10_000 },
    app_service: { ...V1_0.components.app_service, bandwidthMbps: 1_000 },
    external_api: {
      name: "External provider",
      summary:
        "A third party the design calls but can't scale: a card network, an SMS or email provider, customers' webhook endpoints, the open web. It has a rate limit and a price per call, and it can go down.",
      capacity: 0,
      unit: "calls/s",
      latencyMs: 250,
      availability: 0.995,
      costPerNodeHour: 0,
      setByProblem: "each problem's rate limit and price per call",
    },
  },
};

// Every version ever published, oldest first; a design names the one it was drawn
// against.
export const SPEC_VERSIONS: readonly SpecVersion[] = [V1_0, V2_0];
// The newest version, whatever is in effect today: the sheet and the canvas's names.
export const LATEST_SPEC = V2_0;

export function specVersion(version: string): SpecVersion | null {
  return SPEC_VERSIONS.find((s) => s.version === version) ?? null;
}

// A version is in effect from its season boundary on (UTC days).
export function specInEffect(version: string, now: Date): boolean {
  const spec = specVersion(version);
  return spec !== null && spec.date <= now.toISOString().slice(0, 10);
}

// A kind's numbers in a version; the design was refused if the version lacks the kind.
export function statsOf(
  spec: SpecVersion,
  kind: ComponentKind,
): ComponentStats {
  const stats = spec.components[kind];
  if (stats === undefined)
    throw new Error(`spec ${spec.version} has no ${kind}`);
  return stats;
}
