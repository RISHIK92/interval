import { z } from "zod";

// P6-W36 (HLDQ-1, CANVAS-2, CANVAS-4; Q-P6-01): the components an HLD design is built
// from, and what each can be configured with. Their numbers live in spec.ts, the
// public spec sheet; this file is only the shape.

const nodes = (max: number) => z.int().min(1).max(max);
// Spread over availability zones within a region, and over regions.
const placement = {
  zones: z.int().min(1).max(3),
  regions: z.int().min(1).max(2),
};

// Each kind's configuration. A design names one per node.
export const CONFIG = {
  // Where traffic comes from: the problem's users. Exactly one per design.
  client: z.strictObject({}),
  cdn: z.strictObject({ ttlSeconds: z.int().min(0).max(86_400) }),
  load_balancer: z.strictObject({ ...placement }),
  app_service: z.strictObject({ nodes: nodes(200), ...placement }),
  cache: z.strictObject({
    nodes: nodes(64),
    memoryGbPerNode: z.int().min(1).max(256),
    ...placement,
  }),
  sql_db: z.strictObject({
    readReplicas: z.int().min(0).max(15),
    storageGb: z.int().min(10).max(16_000),
    // How the primary survives a failure: not at all, a standby in its zone, or a
    // standby in another zone.
    failover: z.enum(["none", "standby", "multi_zone"]),
    regions: z.int().min(1).max(2),
  }),
  kv_store: z.strictObject({
    nodes: nodes(100),
    replication: z.int().min(1).max(5),
    ...placement,
  }),
  queue: z.strictObject({
    partitions: z.int().min(1).max(256),
    retentionHours: z.int().min(1).max(168),
    ...placement,
  }),
  worker: z.strictObject({ nodes: nodes(200), ...placement }),
  object_storage: z.strictObject({ regions: z.int().min(1).max(2) }),
  search_index: z.strictObject({
    shards: z.int().min(1).max(64),
    replicas: z.int().min(0).max(5),
    ...placement,
  }),
  stream: z.strictObject({
    partitions: z.int().min(1).max(512),
    replication: z.int().min(1).max(3),
    ...placement,
  }),
} as const;

export type ComponentKind = keyof typeof CONFIG;
export const COMPONENT_KINDS = Object.keys(CONFIG) as ComponentKind[];
