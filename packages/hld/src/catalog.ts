import { z } from "zod";
import type { Features } from "./spec";

// P6-W36 (HLDQ-1, CANVAS-2, CANVAS-4; Q-P6-01): the components an HLD design is built
// from, and what each can be configured with. Their numbers live in spec.ts, the
// public spec sheet; this file is only the shape.

const nodes = (max: number) => z.int().min(1).max(max).describe("Nodes");
const batch = () => z.int().min(1).max(1_000).optional().describe("Batch size");
// Spread over availability zones within a region, and over regions. Each field's
// description is its label where the player sets it (the canvas's Selected panel).
const placement = {
  zones: z.int().min(1).max(3).describe("Zones"),
  regions: z.int().min(1).max(2).describe("Regions"),
};

// Each kind's configuration. A design names one per node.
export const CONFIG = {
  // Where traffic comes from: the problem's users. Exactly one per design.
  client: z.strictObject({}),
  cdn: z.strictObject({
    ttlSeconds: z.int().min(0).max(86_400).describe("Cache time (seconds)"),
  }),
  load_balancer: z.strictObject({ ...placement }),
  app_service: z.strictObject({
    nodes: nodes(200),
    // ADR-0050 [batch], spec 2.1: an ID block of this many, handed out without asking
    // again. Absent on a design drawn before 2.1.
    batch: batch(),
    ...placement,
  }),
  cache: z.strictObject({
    nodes: nodes(64),
    memoryGbPerNode: z.int().min(1).max(256).describe("Memory per node (GB)"),
    ...placement,
  }),
  sql_db: z.strictObject({
    readReplicas: z.int().min(0).max(15).describe("Read replicas"),
    storageGb: z.int().min(10).max(16_000).describe("Storage (GB)"),
    // How the primary survives a failure: not at all, a standby in its zone, or a
    // standby in another zone.
    failover: z.enum(["none", "standby", "multi_zone"]).describe("Failover"),
    regions: z.int().min(1).max(2).describe("Regions"),
  }),
  kv_store: z.strictObject({
    nodes: nodes(100),
    replication: z.int().min(1).max(5).describe("Copies of each key"),
    ...placement,
  }),
  queue: z.strictObject({
    partitions: z.int().min(1).max(256).describe("Partitions"),
    retentionHours: z.int().min(1).max(168).describe("Retention (hours)"),
    ...placement,
  }),
  worker: z.strictObject({
    nodes: nodes(200),
    batch: batch(), // [batch], spec 2.1: onward writes in batches of this many
    ...placement,
  }),
  object_storage: z.strictObject({
    regions: z.int().min(1).max(2).describe("Regions"),
  }),
  search_index: z.strictObject({
    shards: z.int().min(1).max(64).describe("Shards"),
    replicas: z.int().min(0).max(5).describe("Replicas"),
    ...placement,
  }),
  stream: z.strictObject({
    partitions: z.int().min(1).max(512).describe("Partitions"),
    replication: z.int().min(1).max(3).describe("Copies of each event"),
    // ADR-0050 [lag], spec 2.0: how long a backlog may wait. Absent on a stream drawn
    // before 2.0, which never held a backlog.
    retentionHours: z
      .int()
      .min(1)
      .max(168)
      .optional()
      .describe("Retention (hours)"),
    ...placement,
  }),
  // ADR-0050 §2, spec 2.0: a third party at the problem's rate limit and price; nothing
  // about it is the player's to set.
  external_api: z.strictObject({}),
  // ADR-0050 §2, spec 2.1.
  geo_index: z.strictObject({
    shards: z.int().min(1).max(64).describe("Shards"),
    replicas: z.int().min(0).max(5).describe("Replicas"),
    ...placement,
  }),
  connection_gateway: z.strictObject({ nodes: nodes(200), ...placement }),
  coordination: z.strictObject({
    // A quorum needs a majority: an odd count, 3, 5 or 7.
    members: z
      .int()
      .min(3)
      .max(7)
      .refine((m) => m % 2 === 1, "3, 5 or 7 members")
      .describe("Members"),
    ...placement,
  }),
} as const;

// ADR-0050 §6: a setting a spec version's feature brings; a design drawn against a
// version without that feature isn't offered it.
export const FIELD_FEATURES: Partial<
  Record<ComponentKind, Record<string, keyof Features>>
> = {
  stream: { retentionHours: "lag" },
  app_service: { batch: "batch" },
  worker: { batch: "batch" },
};

export type ComponentKind = keyof typeof CONFIG;
export const COMPONENT_KINDS = Object.keys(CONFIG) as ComponentKind[];

// What a player reads for each kind: on the canvas, in the Selected panel and in hints.
export const COMPONENT_NAMES: Record<ComponentKind, string> = {
  client: "Client",
  cdn: "CDN",
  load_balancer: "Load balancer",
  app_service: "App service",
  worker: "Worker",
  cache: "Cache",
  sql_db: "SQL database",
  kv_store: "Key-value store",
  object_storage: "Object storage",
  search_index: "Search index",
  queue: "Queue",
  stream: "Stream",
  external_api: "External provider",
  geo_index: "Geo index",
  connection_gateway: "Connection gateway",
  coordination: "Coordination service",
};

// Each node's name for a player, never its id: its kind's name, numbered when the
// design has more than one of that kind ("App service 2").
export function componentNames(
  nodes: readonly { id: string; kind: ComponentKind }[],
): Map<string, string> {
  const total = new Map<ComponentKind, number>();
  for (const n of nodes) total.set(n.kind, (total.get(n.kind) ?? 0) + 1);
  const seen = new Map<ComponentKind, number>();
  const names = new Map<string, string>();
  for (const n of nodes) {
    const i = (seen.get(n.kind) ?? 0) + 1;
    seen.set(n.kind, i);
    const name = COMPONENT_NAMES[n.kind];
    names.set(
      n.id,
      (total.get(n.kind) ?? 0) > 1 ? `${name} ${String(i)}` : name,
    );
  }
  return names;
}
