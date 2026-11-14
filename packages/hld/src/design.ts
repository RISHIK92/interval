import { z } from "zod";
import { CONFIG, type ComponentKind } from "./catalog";

// P6-W36 (CANVAS-2, HLDQ-1): a design is a versioned JSON graph. Nodes are components
// with their configuration and a short "why this choice" note; edges send named
// request types (the problem's: "read", "write", "upload", …) from one node to the
// next. Saved automatically while drawn (W39), so the note may still be empty.

export const DESIGN_VERSION = 1;
export const NOTE_MAX = 280;

const Id = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/, "lowercase, 1-32");
const Position = z.strictObject({ x: z.number(), y: z.number() });

// One node per kind, its config checked against that kind's.
const nodeOf = <K extends ComponentKind>(kind: K) =>
  z.strictObject({
    id: Id,
    kind: z.literal(kind),
    config: CONFIG[kind],
    note: z.string().max(NOTE_MAX).default(""),
    position: Position.optional(), // where the canvas drew it (W39)
  });

export const DesignNode = z.discriminatedUnion("kind", [
  nodeOf("client"),
  nodeOf("cdn"),
  nodeOf("load_balancer"),
  nodeOf("app_service"),
  nodeOf("cache"),
  nodeOf("sql_db"),
  nodeOf("kv_store"),
  nodeOf("queue"),
  nodeOf("worker"),
  nodeOf("object_storage"),
  nodeOf("search_index"),
  nodeOf("stream"),
]);
export type DesignNode = z.infer<typeof DesignNode>;

export const DesignEdge = z.strictObject({
  from: Id,
  to: Id,
  // The request types this edge carries.
  routes: z
    .array(z.string().regex(/^[a-z][a-z_]{0,23}$/))
    .min(1)
    .max(8),
});
export type DesignEdge = z.infer<typeof DesignEdge>;

export const Design = z
  .strictObject({
    version: z.literal(DESIGN_VERSION),
    spec: z.string().regex(/^\d+\.\d+$/), // the spec sheet it was drawn against
    nodes: z.array(DesignNode).max(40),
    edges: z.array(DesignEdge).max(80),
  })
  .superRefine((d, ctx) => {
    const ids = new Set<string>();
    d.nodes.forEach((n, i) => {
      if (ids.has(n.id))
        ctx.addIssue({
          code: "custom",
          path: ["nodes", i, "id"],
          message: "a node id used twice",
        });
      ids.add(n.id);
    });
    const clients = d.nodes.filter((n) => n.kind === "client");
    if (clients.length !== 1)
      ctx.addIssue({
        code: "custom",
        path: ["nodes"],
        message: "a design has exactly one client",
      });
    const client = clients[0]?.id;
    const seen = new Set<string>();
    d.edges.forEach((e, i) => {
      const at = ["edges", i];
      if (!ids.has(e.from) || !ids.has(e.to))
        ctx.addIssue({
          code: "custom",
          path: at,
          message: "an edge to a node that isn't there",
        });
      if (e.from === e.to)
        ctx.addIssue({
          code: "custom",
          path: at,
          message: "an edge from a node to itself",
        });
      if (e.to === client)
        ctx.addIssue({
          code: "custom",
          path: at,
          message: "nothing sends to the client",
        });
      const pair = `${e.from}>${e.to}`;
      if (seen.has(pair))
        ctx.addIssue({
          code: "custom",
          path: at,
          message: "two edges between the same nodes",
        });
      seen.add(pair);
    });
  });
export type Design = z.infer<typeof Design>;
