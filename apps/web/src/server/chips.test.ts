import { describe, expect, test } from "vitest";
import { chipFor, chipLabel } from "./chips";

// Q-P1-16: the link's chip, else the session's, else the onboarding break length.
describe("chipFor", () => {
  const preferences = { breakLength: "3-8" } as const;

  test("a chip in the link wins", () => {
    expect(chipFor("8-15", "1-3", preferences)).toBe("8-15");
  });

  test("without one, the chip chosen earlier this session", () => {
    expect(chipFor(undefined, "1-3", preferences)).toBe("1-3");
  });

  test("otherwise the break length chosen at onboarding", () => {
    expect(chipFor(undefined, undefined, preferences)).toBe("3-8");
  });

  test("values that are not chips are ignored", () => {
    expect(chipFor("99", "x", preferences)).toBe("3-8");
  });

  test("a repeated chip counts by its first value, as the proxy reads it", () => {
    expect(chipFor(["1-3", "8-15"], undefined, preferences)).toBe("1-3");
  });
});

test("chips read as minute ranges", () => {
  expect(chipLabel("1-3")).toBe("1–3 min");
  expect(chipLabel("8-15")).toBe("8–15 min");
});
