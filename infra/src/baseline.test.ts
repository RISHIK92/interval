import { expect, test } from "vitest";

test("vitest runs inside @interval/infra", () => {
  expect(import.meta.url).toContain("/infra/src/");
});
