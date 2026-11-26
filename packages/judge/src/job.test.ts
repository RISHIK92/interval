import { expect, test } from "vitest";
import { JudgeJob, JudgeResult } from "./job";

// Q-WD-17 (LLDQ-4): a named run is a visible test, and only its result says why it
// failed: a name, a short printable message, and the player's line when known.
const id = "00000000-0000-4000-8000-000000000001";
const job = (run: object) => ({
  id,
  priority: "run",
  language: "python",
  files: [{ name: "main.py", content: "" }],
  limits: { seconds: 2, memoryMB: 64 },
  runs: [{ stdin: "{}", ...run }],
  submittedAt: "2026-11-24T10:00:00Z",
});
const result = (failure: object) => ({
  id,
  status: "done",
  runs: [{ verdict: "ok", timeMs: 3, failure }],
});

test("a run may be named, in printable ASCII", () => {
  expect(JudgeJob.safeParse(job({ name: "Test 1" })).success).toBe(true);
  expect(JudgeJob.safeParse(job({})).success).toBe(true);
  expect(JudgeJob.safeParse(job({ name: "" })).success).toBe(false);
  expect(JudgeJob.safeParse(job({ name: "Tést" })).success).toBe(false);
});

test("a failure is a name, a message of at most 200 characters, and a line from 1", () => {
  const ok = { name: "Test 1", message: "call 1 (get): expected 1, got 2" };
  expect(JudgeResult.safeParse(result(ok)).success).toBe(true);
  expect(JudgeResult.safeParse(result({ ...ok, line: 14 })).success).toBe(true);
  expect(JudgeResult.safeParse(result({ ...ok, line: 0 })).success).toBe(false);
  expect(
    JudgeResult.safeParse(result({ ...ok, message: "x".repeat(201) })).success,
  ).toBe(false);
  expect(JudgeResult.safeParse(result({ ...ok, extra: 1 })).success).toBe(
    false,
  );
});

// Owner, 2026-11-26: a compile past its budget is a verdict of its own; every verdict
// before it stays valid, and one outside the list is refused.
test("compile_time_limit is a verdict, beside the ones before it", () => {
  const verdict = (v: string) =>
    JudgeResult.safeParse({
      id,
      status: "done",
      runs: [{ verdict: v, timeMs: 0 }],
    }).success;
  for (const v of [
    "ok",
    "runtime_error",
    "time_limit",
    "memory_limit",
    "output_limit",
    "compile_error",
    "compile_time_limit",
  ])
    expect(verdict(v)).toBe(true);
  expect(verdict("compile_slow")).toBe(false);
});
