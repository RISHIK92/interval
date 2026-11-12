import { Check, ResultLine } from "@interval/lld";
import { z } from "zod";

// P5-W30-S05 (EXEC-2, LOAD-3, LOAD-5, LLDQ-4; owner, 2026-11-12): judging as a service
// any part of Interval can use, in any language: a job is code and runs, nothing about
// battles. A run's stdin is whatever the code reads; with `expected`, its stdout is held
// to those result lines by the checker (EXEC-4), which needs the result-line protocol
// the LLD harnesses speak. Without, the run's verdict alone is the answer.
export const PRIORITIES = ["ranked", "rooms", "casual", "run"] as const;
export const LANGUAGES = [
  "python",
  "javascript",
  "typescript",
  "java",
  "cpp",
  "go",
] as const;

const Run = z.strictObject({
  stdin: z.string().max(1 << 20),
  expected: z.array(ResultLine).max(10_000).optional(),
  checks: z.array(Check).max(20).optional(),
  // Off unless asked: a hidden test's output never reaches a player (LLDQ-4).
  returnOutput: z.boolean().optional(),
});

export const JudgeJob = z.strictObject({
  // The idempotency key (LOAD-5): a job is run once, whoever submits it twice.
  id: z.uuid(),
  priority: z.enum(PRIORITIES),
  language: z.enum(LANGUAGES),
  files: z
    .array(
      z.strictObject({
        name: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/),
        content: z.string().max(1 << 20),
      }),
    )
    .min(1)
    .max(16),
  limits: z.strictObject({
    seconds: z.int().min(1).max(30),
    memoryMB: z.int().min(32).max(1024),
  }),
  runs: z.array(Run).min(1).max(100),
  submittedAt: z.iso.datetime(),
});
export type JudgeJob = z.infer<typeof JudgeJob>;

const Mismatch = z.strictObject({
  call: z.int().nonnegative(),
  reason: z.string().max(40),
});

export const JudgeResult = z.strictObject({
  id: z.uuid(),
  // failed: the engine's own fault, never the code's.
  status: z.enum(["done", "failed"]),
  error: z.string().max(500).optional(),
  runs: z
    .array(
      z.strictObject({
        verdict: z.enum([
          "ok",
          "runtime_error",
          "time_limit",
          "memory_limit",
          "output_limit",
          "compile_error",
        ]),
        timeMs: z.int().nonnegative(),
        report: z
          .strictObject({
            passed: z.boolean(),
            firstMismatch: Mismatch.optional(),
          })
          .optional(),
        stdout: z.string().optional(),
        stderr: z.string().optional(),
      }),
    )
    .max(100),
});
export type JudgeResult = z.infer<typeof JudgeResult>;
