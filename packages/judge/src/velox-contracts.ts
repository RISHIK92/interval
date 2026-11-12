// P5-W30-S06 (ADR-0041 PROPOSED, ADR-0040): Velox runs and judges code, and Interval
// owns the contracts it speaks. This writes them into a Velox checkout: the JSON Schemas
// and the Go types generated from the zod definitions, beside the Velox packages that use
// them (lld, judgejob), which Velox commits and its CI
// is to hold to the schemas (P5-W30-S07). Run `pnpm contracts:velox` in Interval;
// VELOX_DIR defaults to ../velox beside this repo.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Check, goTypes, Interface, ResultLine, Scenario } from "@interval/lld";
import { z } from "zod";
import { JudgeJob, JudgeResult } from "./job";

const velox =
  process.env["VELOX_DIR"] ?? join(import.meta.dirname, "../../../../velox");
// A typo'd VELOX_DIR must fail, not leave a stray tree that looks written.
if (!existsSync(join(velox, "backend/go.mod")))
  throw new Error(`${velox} is not a Velox checkout (no backend/go.mod)`);
const out = join(velox, "backend");

const files: Record<string, string> = {
  "lld/types.go": goTypes(
    "lld",
    { Scenario, ResultLine, Check },
    { calls: "Call", concurrent: "Concurrent", "Concurrent.threads": "Call" },
  ),
  "judgejob/types.go": goTypes(
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
  ),
};
// The schemas from the same zod as the Go, never the committed copies, which may be stale.
const schemas = {
  "lld.interface": Interface,
  "lld.scenario": Scenario,
  "lld.result": ResultLine,
  "lld.check": Check,
  "judge.job": JudgeJob,
  "judge.result": JudgeResult,
};
for (const [name, schema] of Object.entries(schemas))
  files[`contract/schema/${name}.schema.json`] =
    `${JSON.stringify(z.toJSONSchema(schema, { io: "input" }), null, 2)}\n`;
for (const [path, body] of Object.entries(files)) {
  mkdirSync(dirname(join(out, path)), { recursive: true });
  writeFileSync(join(out, path), body);
}
console.log(`contracts written to ${out}`);
