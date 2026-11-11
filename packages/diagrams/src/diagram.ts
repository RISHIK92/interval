import { z } from "zod";

// P4.5-W25-S01 (Q-P4.5-01; owner, 2026-11-11): a diagram is data, apart from how it's
// drawn: system shapes placed on a grid (no automatic layout), and arrows between them.
// The HLD canvas (CANVAS-1) reuses the shapes as React Flow nodes later.
export const KINDS = [
  "client",
  "service",
  "database",
  "cache",
  "queue",
  "group",
  "note",
] as const;
export type Kind = (typeof KINDS)[number];

// The grid is as large as a phone's width allows legibly; a diagram is a small idea.
export const COLS = 24;
export const ROWS = 16;

// Each kind's size in cells unless the diagram says otherwise.
export const DEFAULT_SIZE: Record<Kind, { cols: number; rows: number }> = {
  client: { cols: 2, rows: 2 },
  service: { cols: 3, rows: 2 },
  database: { cols: 2, rows: 2 },
  cache: { cols: 3, rows: 2 },
  queue: { cols: 3, rows: 2 },
  group: { cols: 4, rows: 4 },
  note: { cols: 3, rows: 2 },
};

const Id = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/);

// About 8 units a character at the 13-unit label size: a label fits its shape's width.
export const CHARS_PER_CELL = 5;

const Shape = z
  .strictObject({
    id: Id,
    kind: z.enum(KINDS),
    label: z.string().min(1).max(40),
    at: z.strictObject({
      col: z
        .number()
        .int()
        .min(0)
        .max(COLS - 1),
      row: z
        .number()
        .int()
        .min(0)
        .max(ROWS - 1),
    }),
    size: z
      .strictObject({
        cols: z.number().int().min(1).max(COLS),
        rows: z.number().int().min(1).max(ROWS),
      })
      .optional(),
  })
  .refine(
    (s) => {
      const size = s.size ?? DEFAULT_SIZE[s.kind];
      return s.at.col + size.cols <= COLS && s.at.row + size.rows <= ROWS;
    },
    { message: "the shape runs off the grid" },
  )
  .refine(
    (s) =>
      s.label.length <= (s.size ?? DEFAULT_SIZE[s.kind]).cols * CHARS_PER_CELL,
    { message: "the label is longer than its shape is wide" },
  );
export type Shape = z.infer<typeof Shape>;

const Arrow = z.strictObject({
  from: Id,
  to: Id,
  label: z.string().min(1).max(20).optional(),
  // Dashed: asynchronous (a message, a replication), as system diagrams draw it.
  style: z.enum(["solid", "dashed"]).default("solid"),
});
export type Arrow = z.infer<typeof Arrow>;

function overlap(a: Shape, b: Shape): boolean {
  const sa = a.size ?? DEFAULT_SIZE[a.kind];
  const sb = b.size ?? DEFAULT_SIZE[b.kind];
  return (
    a.at.col < b.at.col + sb.cols &&
    b.at.col < a.at.col + sa.cols &&
    a.at.row < b.at.row + sb.rows &&
    b.at.row < a.at.row + sa.rows
  );
}

export const Diagram = z
  .strictObject({
    title: z.string().min(1).max(80),
    shapes: z.array(Shape).min(1).max(24),
    arrows: z.array(Arrow).max(32),
  })
  .superRefine((d, ctx) => {
    const ids = new Set<string>();
    for (const s of d.shapes) {
      if (ids.has(s.id))
        ctx.addIssue({ code: "custom", message: `${s.id} is used twice` });
      ids.add(s.id);
    }
    // Shapes never sit on each other (a group holds others, so it may); arrows would
    // otherwise run backwards or vanish between them.
    const solid = d.shapes.filter((s) => s.kind !== "group");
    for (const [i, a] of solid.entries())
      for (const b of solid.slice(i + 1))
        if (overlap(a, b))
          ctx.addIssue({
            code: "custom",
            message: `${a.id} and ${b.id} overlap`,
          });
    // One arrow a pair, either way: its key (from->to) names it for scene steps.
    const pairs = new Set<string>();
    for (const a of d.arrows) {
      for (const end of [a.from, a.to])
        if (!ids.has(end))
          ctx.addIssue({ code: "custom", message: `no shape ${end}` });
      if (a.from === a.to)
        ctx.addIssue({ code: "custom", message: `${a.from} points at itself` });
      const pair = [a.from, a.to].sort().join(" ");
      if (pairs.has(pair))
        ctx.addIssue({
          code: "custom",
          message: `${a.from} and ${a.to} are joined twice`,
        });
      pairs.add(pair);
    }
  });
export type Diagram = z.infer<typeof Diagram>;
