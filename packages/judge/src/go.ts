import { goTypes } from "@interval/lld";
import { JudgeJob, JudgeResult } from "./job";

// The judge contract as Go (ADR-0040), for every Go caller of it: Velox's workers
// (`pnpm contracts:velox`) and Interval's game server (P5-W31-S02b), from one place.
export function judgeGoTypes(pkg: string, regenerate: string): string {
  return goTypes(
    pkg,
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
    regenerate,
  );
}
