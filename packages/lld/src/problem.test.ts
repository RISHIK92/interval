import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { interfaceFor, Problem, scenariosOf } from "./problem";

// P5-W30-S01 (LLDQ-1 to LLDQ-4): a problem file, held to its interface throughout.
const sample = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "../fixtures/problems/inventory/problem.json"),
    "utf8",
  ),
) as Record<string, unknown> & {
  layers: { visible: unknown[]; hidden: unknown[]; concurrency: unknown[] };
};
const ok = (p: object) => Problem.safeParse(p).success;

test("the fixture problem is a problem", () => {
  expect(ok(sample)).toBe(true);
});

test("every scenario fits the interface; checks name real methods", () => {
  expect(
    ok({
      ...sample,
      layers: {
        ...sample.layers,
        hidden: [{ calls: [{ method: "nope", args: [] }] }],
      },
    }),
  ).toBe(false);
  expect(
    ok({ ...sample, checks: [{ method: "nope", compare: "exact" }] }),
  ).toBe(false);
  expect(
    ok({
      ...sample,
      checks: [
        { method: "items", compare: "exact" },
        { method: "items", compare: "unordered" },
      ],
    }),
  ).toBe(false);
});

test("a comparison that fits its method", () => {
  const check = (c: object) => ok({ ...sample, checks: [c] });
  expect(check({ method: "clear", compare: "exact" })).toBe(false);
  expect(check({ method: "stock", compare: "unordered" })).toBe(false);
  expect(
    check({ method: "items", compare: "unordered", tolerance: 0.01 }),
  ).toBe(false);
  expect(check({ method: "share", compare: "approx", tolerance: 0.01 })).toBe(
    true,
  );
});

test("a kebab-case slug, and hidden tests always", () => {
  expect(ok({ ...sample, slug: "Inventory_1" })).toBe(false);
  expect(ok({ ...sample, layers: { ...sample.layers, hidden: [] } })).toBe(
    false,
  );
  expect(ok({ ...sample, limits: { seconds: 0, memoryMB: 128 } })).toBe(false);
});

// P5-W30-S02b: threads belong in the concurrency layer, and every scenario there has them.
test("threads only in the concurrency layer, and always there", () => {
  const [threaded] = sample.layers.concurrency;
  const plain = sample.layers.visible[0];
  expect(
    ok({ ...sample, layers: { ...sample.layers, visible: [threaded] } }),
  ).toBe(false);
  expect(
    ok({ ...sample, layers: { ...sample.layers, concurrency: [plain] } }),
  ).toBe(false);
  const { visible, hidden } = sample.layers;
  expect(ok({ ...sample, layers: { visible, hidden } })).toBe(true);
});

// P5-W31-S02a (§6.5, Q-P5-15): the extension round adds methods, and its scenarios are
// judged against the extended interface; base layers never see the new methods.
test("an extension adds methods its own scenarios use, never clashing with the base", () => {
  const added = {
    name: "reserve",
    params: [
      { name: "item", type: "string" },
      { name: "amount", type: "int" },
    ],
    returns: "bool",
  };
  const uses = {
    calls: [
      { method: "new", args: [10] },
      { method: "reserve", args: ["a", 1] },
    ],
  };
  const withExt = (extension: object) => ({ ...sample, extension });
  expect(ok(withExt({ methods: [added], scenarios: [uses] }))).toBe(true);
  // A clash with a base method, an unused extension, a scenario of base methods only.
  const clash = { ...added, name: "add" };
  expect(ok(withExt({ methods: [clash], scenarios: [uses] }))).toBe(false);
  expect(ok(withExt({ methods: [added], scenarios: [] }))).toBe(false);
  expect(
    ok(
      withExt({
        methods: [added],
        scenarios: [{ calls: [{ method: "new", args: [10] }] }],
      }),
    ),
  ).toBe(false);
  // Base layers can't call it: they're judged against the base interface.
  expect(
    ok({
      ...withExt({ methods: [added], scenarios: [uses] }),
      layers: { ...sample.layers, visible: [uses] },
    }),
  ).toBe(false);
  const parsed = Problem.parse(
    withExt({ methods: [added], scenarios: [uses] }),
  );
  expect(scenariosOf(parsed).at(-1)).toEqual({
    layer: "extension",
    index: 0,
    scenario: uses,
  });
  expect(
    interfaceFor(parsed, "hidden").methods.map((m) => m.name),
  ).not.toContain("reserve");
  expect(
    interfaceFor(parsed, "extension").methods.map((m) => m.name),
  ).toContain("reserve");
  // No threads in the extension layer, and the extended interface keeps its 20-method cap.
  expect(
    ok(
      withExt({
        methods: [added],
        scenarios: [
          {
            ...uses,
            concurrent: {
              after: 1,
              threads: [[uses.calls[1]], [uses.calls[1]]],
            },
          },
        ],
      }),
    ),
  ).toBe(false);
  const many = Array.from({ length: 10 }, (_, i) => ({
    ...added,
    name: `extra${String(i)}`,
  }));
  expect(
    ok(
      withExt({
        methods: many,
        scenarios: [
          { calls: [uses.calls[0], { method: "extra0", args: ["a", 1] }] },
        ],
      }),
    ),
  ).toBe(false);
});
