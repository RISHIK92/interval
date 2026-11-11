import { z } from "zod";
import { arrowKey } from "./describe";
import { COLS, Diagram, ROWS } from "./diagram";

// P4.5-W25-S02 (TTS-5, TTS-3; owner, Q-P4.5-02): a visual explainer is one diagram and
// its steps, each starting at a word of the explainer's captions (so it follows the
// stored word timings at any speed). Nothing shows before the first step; `show` and
// `hide` add up from step to step, as do moves; a highlight lasts its own step.
// This zod schema is the one definition: the JSON Schema the worker checks drafts
// against is generated from it (timelineJsonSchema), structure only; the rules below
// that a schema can't say are checked here, once (owner, 2026-11-11).

const Ref = z.string().min(1).max(70);

// Strict objects throughout (here and in diagram.ts): a model's draft with stray keys
// is refused, as the generated schema's additionalProperties: false refuses it in
// Python, so the two never disagree.
const Step = z.strictObject({
  // A word's index; no explainer runs near this many words.
  at: z.number().int().min(0).max(9999),
  show: z.array(Ref).max(32).optional(),
  hide: z.array(Ref).max(32).optional(),
  highlight: z.array(Ref).max(8).optional(),
  move: z
    .array(
      z.strictObject({
        id: Ref,
        to: z.strictObject({
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
      }),
    )
    .max(8)
    .optional(),
  // For screen readers: what this step shows, in words (W27).
  describe: z.string().min(1).max(200),
});

const Shape = z.strictObject({
  diagram: Diagram,
  steps: z.array(Step).min(1).max(20),
});

// Each step's own picture, as the steps before it leave it.
export function* frames(t: z.infer<typeof Shape>) {
  const shown = new Set<string>();
  let diagram = t.diagram;
  for (const step of t.steps) {
    for (const id of step.show ?? []) shown.add(id);
    for (const id of step.hide ?? []) shown.delete(id);
    if (step.move !== undefined) {
      const to = new Map(step.move.map((m) => [m.id, m.to]));
      diagram = {
        ...diagram,
        shapes: diagram.shapes.map((s) => ({ ...s, at: to.get(s.id) ?? s.at })),
      };
    }
    yield { step, shown: new Set(shown), diagram };
  }
}

export const Timeline = Shape.superRefine((t, ctx) => {
  const shapes = new Set(t.diagram.shapes.map((s) => s.id));
  const known = new Set([...shapes, ...t.diagram.arrows.map(arrowKey)]);
  const fail = (message: string) => {
    ctx.addIssue({ code: "custom", message });
  };
  t.steps.forEach((step, i) => {
    const before = t.steps[i - 1];
    if (before !== undefined && step.at <= before.at)
      fail(`step ${String(i)} starts before the one before it`);
    // One meaning per step: not shown and hidden at once, not moved twice.
    const hiding = new Set(step.hide ?? []);
    if ((step.show ?? []).some((id) => hiding.has(id)))
      fail(`step ${String(i)} shows and hides the same thing`);
    const moving = (step.move ?? []).map((m) => m.id);
    if (new Set(moving).size !== moving.length)
      fail(`step ${String(i)} moves a shape twice`);
    for (const id of [
      ...(step.show ?? []),
      ...(step.hide ?? []),
      ...(step.highlight ?? []),
    ])
      if (!known.has(id)) fail(`step ${String(i)}: no shape or arrow ${id}`);
    for (const m of step.move ?? [])
      if (!shapes.has(m.id))
        fail(`step ${String(i)}: no shape ${m.id} to move`);
  });
  // A diagram invalid from the start is reported by Diagram itself; its steps aren't
  // blamed for it.
  if (!Diagram.safeParse(t.diagram).success) return;
  let i = 0;
  let valid = true;
  for (const frame of frames(t)) {
    // After its moves, still on the grid with nothing on top of anything. A hidden
    // shape still holds its place (the view box keeps every shape's place), so nothing
    // moves onto it. Reported at the step that breaks it, not again after.
    const now = Diagram.safeParse(frame.diagram).success;
    if (valid && !now)
      fail(`step ${String(i)} moves a shape off the grid or onto another`);
    valid = now;
    for (const id of frame.step.highlight ?? [])
      if (!frame.shown.has(id))
        fail(`step ${String(i)} highlights ${id}, not shown`);
    i += 1;
  }
});
export type Timeline = z.infer<typeof Timeline>;

// Every step's word is one of the explainer's captions (they come with the explainer,
// not the timeline, so this is checked where both are at hand).
export const checkAnchors = (t: Timeline, captionCount: number) =>
  t.steps.every((s) => s.at < captionCount);

// The JSON Schema the worker checks a model's draft against (jsonschema, W26): the
// structure only. schema/timeline.schema.json is this, committed (`pnpm schema`).
// "input": what a draft may say (a style left to its default isn't required).
export const timelineJsonSchema = () => z.toJSONSchema(Shape, { io: "input" });
