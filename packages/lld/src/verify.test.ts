import { expect, test } from "vitest";
import { recorded } from "./verify";

// Q-WD-17: expected.json holds what a submission is held to, never where the reference
// raised its errors.
test("a recorded error keeps no line; a value is kept as it is", () => {
  expect(recorded({ call: 2, error: "ValueError: full", line: 23 })).toEqual({
    call: 2,
    error: "ValueError: full",
  });
  expect(recorded({ call: 1, value: [1, "a"] })).toEqual({
    call: 1,
    value: [1, "a"],
  });
});
