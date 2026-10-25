import { expect, test } from "vitest";
import { prepare } from "./queue";

// ADR-0014: every adapter checks the same things before anything is sent.
test("a message is validated against its schema", () => {
  expect(prepare("discover_source", { source_id: 3 }, "k1", 0)).toEqual({
    source_id: 3,
  });
  for (const bad of [
    { source_id: 0 },
    { source_id: "3" },
    { source_id: 3, extra: 1 },
  ]) {
    expect(() => prepare("discover_source", bad as never, "k1", 0)).toThrow();
  }
});

test("delays are 0 to 900 seconds, what SQS allows", () => {
  expect(() => prepare("discover_source", { source_id: 1 }, "k1", 901)).toThrow(
    /900/,
  );
  expect(() => prepare("discover_source", { source_id: 1 }, "k1", -1)).toThrow(
    /900/,
  );
  expect(prepare("discover_source", { source_id: 1 }, "k1", 900)).toEqual({
    source_id: 1,
  });
});

test.each(["", "42", "discover_source:7", "x".repeat(201)])(
  "the key %j is refused (BullMQ can't use it as a job id)",
  (key) => {
    expect(() => prepare("discover_source", { source_id: 1 }, key, 0)).toThrow(
      /idempotencyKey/,
    );
  },
);
