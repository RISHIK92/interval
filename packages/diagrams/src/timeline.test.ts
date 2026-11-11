import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { checkAnchors, Timeline, timelineJsonSchema } from "./timeline";
import { stateAt, stepAt } from "./clock";

// P4.5-W25-S02 (TTS-5, TTS-3; Q-P4.5-02): a timeline is a diagram and its steps, each
// anchored to a word of the explainer's captions; the clock both players share.
const diagram = {
  title: "Leader election",
  shapes: [
    { id: "a", kind: "service", label: "Node A", at: { col: 0, row: 0 } },
    { id: "b", kind: "service", label: "Node B", at: { col: 5, row: 0 } },
    { id: "c", kind: "service", label: "Node C", at: { col: 0, row: 4 } },
  ],
  arrows: [{ from: "a", to: "b", label: "vote" }],
};
const steps = [
  { at: 0, show: ["a", "b", "c"], describe: "Three nodes, no leader." },
  { at: 3, highlight: ["a"], describe: "Node A's timer runs out first." },
  {
    at: 6,
    show: ["a->b"],
    highlight: ["a->b"],
    describe: "A asks B for a vote.",
  },
  {
    at: 9,
    hide: ["c"],
    move: [{ id: "b", to: { col: 5, row: 4 } }],
    describe: "C drops out; B moves down.",
  },
];
const timeline = Timeline.parse({ diagram, steps });
const ok = (t: object) => Timeline.safeParse(t).success;
// A word every half second.
const captions = Array.from({ length: 12 }, (_, i) => ({ start: i / 2 }));

test("a timeline parses; its rules refuse what can't be drawn", () => {
  expect(ok({ diagram, steps })).toBe(true);
  // Anchors in order.
  expect(ok({ diagram, steps: [steps[1], steps[0]] })).toBe(false);
  expect(ok({ diagram, steps: [steps[0], { ...steps[1], at: 0 }] })).toBe(
    false,
  );
  // Only what exists.
  expect(ok({ diagram, steps: [{ at: 0, show: ["z"], describe: "x" }] })).toBe(
    false,
  );
  expect(
    ok({ diagram, steps: [{ at: 0, show: ["b->a"], describe: "x" }] }),
  ).toBe(false);
  // A move off the grid, or onto another shape.
  const moved = (to: object) => ({
    diagram,
    steps: [steps[0], { at: 1, move: [{ id: "b", to }], describe: "x" }],
  });
  expect(ok(moved({ col: 23, row: 0 }))).toBe(false);
  expect(ok(moved({ col: 1, row: 4 }))).toBe(false);
  // A highlight of something not shown.
  expect(
    ok({ diagram, steps: [{ at: 0, highlight: ["a"], describe: "x" }] }),
  ).toBe(false);
  // Each step speaks for screen readers; twenty steps at most.
  expect(ok({ diagram, steps: [{ at: 0, show: ["a"], describe: "" }] })).toBe(
    false,
  );
  expect(
    ok({
      diagram,
      steps: Array.from({ length: 21 }, (_, i) => ({ at: i, describe: "x" })),
    }),
  ).toBe(false);
});

test("anchors lie within the explainer's captions", () => {
  expect(checkAnchors(timeline, 12)).toBe(true);
  expect(checkAnchors(timeline, 9)).toBe(false);
});

test("the step is the last whose word has started", () => {
  expect(stepAt(timeline, captions, 0)).toBe(0);
  // Word 3 starts at 1.5 s.
  expect(stepAt(timeline, captions, 1.49)).toBe(0);
  expect(stepAt(timeline, captions, 1.5)).toBe(1);
  expect(stepAt(timeline, captions, 3.2)).toBe(2);
  expect(stepAt(timeline, captions, 99)).toBe(3);
  // Before the first word (a timeline whose first step comes later).
  const late = Timeline.parse({ diagram, steps: [{ ...steps[0], at: 2 }] });
  expect(stepAt(late, captions, 0.5)).toBe(-1);
});

test("shows and hides add up, a highlight lasts its step, a move stays", () => {
  const before = stateAt(timeline, -1);
  expect(before.hidden.sort()).toEqual(["a", "a->b", "b", "c"]);
  expect(before.describe).toBe("");
  expect(stateAt(timeline, 0)).toMatchObject({
    hidden: ["a->b"],
    highlight: [],
    describe: "Three nodes, no leader.",
  });
  expect(stateAt(timeline, 1).highlight).toEqual(["a"]);
  expect(stateAt(timeline, 2)).toMatchObject({
    hidden: [],
    highlight: ["a->b"],
  });
  const last = stateAt(timeline, 3);
  expect(last.hidden).toEqual(["c"]);
  expect(last.highlight).toEqual([]);
  expect(last.diagram.shapes.find((s) => s.id === "b")?.at).toEqual({
    col: 5,
    row: 4,
  });
  // The timeline itself is untouched.
  expect(timeline.diagram.shapes.find((s) => s.id === "b")?.at).toEqual({
    col: 5,
    row: 0,
  });
});

// `pnpm --filter @interval/diagrams schema` writes it (UPDATE_SCHEMA=1); otherwise
// this fails while the committed file is stale, so CI catches a forgotten regeneration.
test("the committed JSON Schema is the one the zod schema generates", () => {
  const file = join(
    import.meta.dirname,
    "..",
    "schema",
    "timeline.schema.json",
  );
  const fresh = timelineJsonSchema();
  if (process.env["UPDATE_SCHEMA"] === "1")
    writeFileSync(file, `${JSON.stringify(fresh, null, 2)}\n`);
  const committed: unknown = JSON.parse(readFileSync(file, "utf8"));
  expect(committed).toEqual(fresh);
});

// What zod accepts, the schema the worker uses (jsonschema) accepts too, and the other
// way round: each object's required keys are there, and no key it doesn't list is.
type Node = {
  type?: string;
  properties?: Record<string, Node>;
  required?: string[];
  additionalProperties?: boolean;
  items?: Node;
};
function fits(value: unknown, schema: Node, at: string): string[] {
  if (Array.isArray(value) && schema.items !== undefined) {
    const items = schema.items;
    return value.flatMap((v, i) => fits(v, items, `${at}[${String(i)}]`));
  }
  if (
    typeof value !== "object" ||
    value === null ||
    schema.properties === undefined
  )
    return [];
  const props = schema.properties;
  const keys = Object.keys(value);
  return [
    ...(schema.required ?? [])
      .filter((k) => !keys.includes(k))
      .map((k) => `${at}: ${k} is required`),
    ...(schema.additionalProperties === false
      ? keys
          .filter((k) => !(k in props))
          .map((k) => `${at}: ${k} isn't allowed`)
      : []),
    ...keys.flatMap((k) => {
      const child = props[k];
      return child === undefined
        ? []
        : fits((value as Record<string, unknown>)[k], child, `${at}.${k}`);
    }),
  ];
}

test("the schema accepts what zod accepts, defaults left out, stray keys refused", () => {
  const schema = timelineJsonSchema() as Node;
  // The fixture's arrow leaves its style to the default.
  expect(fits({ diagram, steps }, schema, "timeline")).toEqual([]);
  expect(
    fits(
      { diagram, steps: [{ ...steps[0], colour: "red" }] },
      schema,
      "timeline",
    ),
  ).toEqual(["timeline.steps[0]: colour isn't allowed"]);
  // zod refuses the stray key too.
  expect(ok({ diagram, steps: [{ ...steps[0], colour: "red" }] })).toBe(false);
});

test("one meaning per step: not shown and hidden at once, no shape moved twice", () => {
  expect(
    ok({
      diagram,
      steps: [{ at: 0, show: ["a"], hide: ["a"], describe: "x" }],
    }),
  ).toBe(false);
  expect(
    ok({
      diagram,
      steps: [
        steps[0],
        {
          at: 1,
          move: [
            { id: "b", to: { col: 5, row: 4 } },
            { id: "b", to: { col: 9, row: 4 } },
          ],
          describe: "x",
        },
      ],
    }),
  ).toBe(false);
});

test("a later step can't highlight what an earlier one hid; a move onto a moved shape is refused", () => {
  expect(
    ok({
      diagram,
      steps: [
        steps[0],
        { at: 1, hide: ["c"], describe: "x" },
        { at: 2, highlight: ["c"], describe: "x" },
      ],
    }),
  ).toBe(false);
  // B moves under A at step 1; C can't then move onto B's new place.
  expect(
    ok({
      diagram,
      steps: [
        steps[0],
        { at: 1, move: [{ id: "b", to: { col: 0, row: 8 } }], describe: "x" },
        { at: 2, move: [{ id: "c", to: { col: 1, row: 8 } }], describe: "x" },
      ],
    }),
  ).toBe(false);
});

test("a bad move is reported once, at its step; a bad diagram blames no step", () => {
  const issues = Timeline.safeParse({
    diagram,
    steps: [
      steps[0],
      { at: 1, move: [{ id: "b", to: { col: 1, row: 4 } }], describe: "x" },
      { at: 2, move: [{ id: "a", to: { col: 9, row: 9 } }], describe: "x" },
    ],
  }).error?.issues.map((i) => i.message);
  expect(issues).toEqual(["step 1 moves a shape off the grid or onto another"]);
  const overlapping = {
    ...diagram,
    shapes: [
      ...diagram.shapes,
      { id: "d", kind: "service", label: "D", at: { col: 1, row: 0 } },
    ],
  };
  const blamed = Timeline.safeParse({
    diagram: overlapping,
    steps: [
      { at: 0, move: [{ id: "c", to: { col: 9, row: 9 } }], describe: "x" },
    ],
  }).error?.issues.map((i) => i.message);
  expect(blamed?.some((m) => m.startsWith("step"))).toBe(false);
});

test("no captions: never started; a step past the last is a mistake, not a blank", () => {
  expect(stepAt(timeline, [], 5)).toBe(-1);
  expect(() => stateAt(timeline, 4)).toThrow(RangeError);
});
