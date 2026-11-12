import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { goTypes } from "@interval/lld";
import { expect, test } from "vitest";
import { z } from "zod";
import { JudgeJob, JudgeResult } from "./job";

// P5-W30-S05 (ADR-0040 PROPOSED): the judge's contract as JSON Schema (for any service,
// Python's included) and Go (the workers), generated and stale-checked.
const update = process.env["UPDATE_GENERATED"] === "1";
const root = join(import.meta.dirname, "..");

function same(file: string, fresh: string, parse: boolean) {
  if (update) writeFileSync(file, fresh);
  const committed = readFileSync(file, "utf8");
  if (parse) expect(JSON.parse(committed)).toEqual(JSON.parse(fresh));
  else expect(committed).toBe(fresh);
}

test("the committed JSON Schemas are the ones the contract generates", () => {
  for (const [name, schema] of Object.entries({
    job: JudgeJob,
    result: JudgeResult,
  }))
    same(
      join(root, "schema", `${name}.schema.json`),
      `${JSON.stringify(z.toJSONSchema(schema, { io: "input" }), null, 2)}\n`,
      true,
    );
});

test("the workers' Go types are the ones the contract generates", () => {
  same(
    join(root, "../../services/exec/judge/types.go"),
    goTypes(
      "judge",
      { JudgeJob, JudgeResult },
      {
        files: "File",
        limits: "Limits",
        "JudgeJob.runs": "Run",
        "JudgeResult.runs": "RunResult",
        expected: "ResultLine",
        checks: "Check",
        report: "Report",
        firstMismatch: "Mismatch",
      },
      "pnpm --filter @interval/judge codegen",
    ),
    false,
  );
});
