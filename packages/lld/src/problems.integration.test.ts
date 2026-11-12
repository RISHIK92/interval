import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { MUTATION_GATE, mutationScore } from "./mutation";
import { verify } from "./verify";

// P5-W30-S03 (LLDQ-2, LLDQ-3; Phase 5 "done when"): every problem's references agree,
// on its own scenarios and on random ones, and its tests catch at least 90% of the
// Python reference's mutants. Needs Docker and Go: EXEC_INTEGRATION=1.
const integration = process.env["EXEC_INTEGRATION"] === "1";
// Per problem; well inside the CI job's 45 minutes, so a slow problem is named.
const SLOW = 600_000;
const repo = join(import.meta.dirname, "../../..");
const problemsDir = join(repo, "problems/lld");
let build = "";
let exec = "";
afterAll(() => {
  if (build !== "") rmSync(build, { recursive: true, force: true });
});
beforeAll(() => {
  if (!integration) return;
  build = mkdtempSync(join(tmpdir(), "lld-exec-"));
  exec = join(build, "exec");
  execFileSync("go", ["build", "-o", exec, "."], {
    cwd: join(repo, "services/exec"),
  });
}, SLOW);

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
