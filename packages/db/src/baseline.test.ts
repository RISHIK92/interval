import { expect, test } from "vitest";

test("vitest runs inside @interval/db", () => {
  expect(import.meta.url).toContain("/packages/db/src/");
});
