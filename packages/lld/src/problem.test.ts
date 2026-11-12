import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { Problem } from "./problem";

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
