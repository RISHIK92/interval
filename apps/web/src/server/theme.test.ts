import { expect, test } from "vitest";
import { parseTheme } from "./theme";

// Light, dark or the device's own setting, chosen per device (owner, 2026-10-26).
test.each([
  ["light", "light"],
  ["dark", "dark"],
  ["system", "system"],
  [undefined, "system"],
  ["purple", "system"],
  ["", "system"],
] as const)("%s reads as %s", (value, expected) => {
  expect(parseTheme(value)).toBe(expected);
});
