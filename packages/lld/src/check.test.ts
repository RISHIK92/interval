import { expect, test } from "vitest";
import { Check } from "./check";

// P5-W29-S03 (EXEC-4): a method's comparison, as a problem declares it.
test("a comparison per method, with a small tolerance only", () => {
  const ok = (c: object) => Check.safeParse(c).success;
  expect(ok({ method: "items", compare: "unordered" })).toBe(true);
  expect(ok({ method: "share", compare: "approx", tolerance: 1e-6 })).toBe(
    true,
  );
  expect(ok({ method: "share", compare: "close" })).toBe(false);
  expect(ok({ method: "share", compare: "approx", tolerance: 0 })).toBe(false);
  expect(ok({ method: "share", compare: "approx", tolerance: 0.5 })).toBe(
    false,
  );
  expect(ok({ method: "items", compare: "exact", extra: 1 })).toBe(false);
});
