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

export type SpecVersion = {
  version: string;
  date: string; // ISO day it took effect
  provisional: boolean;
  components: Record<ComponentKind, ComponentStats>;
  notes: string[]; // the patch notes: what changed from the version before
  engine: EngineConstants;
};

const V1_0: SpecVersion = {
  version: "1.0",
  date: "2026-11-14",
  provisional: true,
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
};

// Every version ever published, oldest first; a design names the one it was drawn
// against.
export const SPEC_VERSIONS: readonly SpecVersion[] = [V1_0];
export const CURRENT_SPEC = V1_0;

export function specVersion(version: string): SpecVersion | null {
  return SPEC_VERSIONS.find((s) => s.version === version) ?? null;
}
