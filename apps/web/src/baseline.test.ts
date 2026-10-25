import { expect, test } from "vitest";

test("vitest runs inside @interval/web", () => {
  expect(import.meta.url).toContain("/apps/web/src/");
});
