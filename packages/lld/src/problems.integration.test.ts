import { readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { MUTATION_GATE, mutationScore } from "./mutation";
import { verify } from "./verify";

// P5-W30-S03 (LLDQ-2, LLDQ-3; Phase 5 "done when"): every problem's references agree,
// on its own scenarios and on random ones, and its tests catch at least 90% of the
// Python reference's mutants.
// The execution engine's binary, with its `run` and `check` commands (Velox's, ADR-0041
// PROPOSED); these tests skip without it.
const exec = process.env["EXEC_BIN"] ?? "";
const integration = exec !== "";
// Per problem; well inside the CI job's 45 minutes, so a slow problem is named.
const SLOW = 600_000;
const repo = join(import.meta.dirname, "../../..");
const problemsDir = join(repo, "problems/lld");

for (const slug of readdirSync(problemsDir).filter((s) => !s.startsWith(".")))
  test.runIf(integration)(
    `${slug}: verified, and its tests catch the reference's mutants`,
    () => {
      const dir = join(problemsDir, slug);
      const { failures, expected } = verify(dir, {
        exec,
        mode: "check",
        random: 5,
      });
      expect(failures).toEqual([]);
      const score = mutationScore(dir, { exec, expected });
      expect(
        score.killed / score.total,
        JSON.stringify(score.survivors),
      ).toBeGreaterThanOrEqual(MUTATION_GATE);
    },
    SLOW,
  );
