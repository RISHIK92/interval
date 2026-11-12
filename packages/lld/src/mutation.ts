import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { python } from "./generate/python";
import { Problem, scenariosOf } from "./problem";
import type { Expected } from "./verify";

// P5-W30-S02 (LLDQ-2; Phase 5 "Done when": tests catch at least 90% of injected bugs):
// each mutant of the Python reference (tools/mutants.py) is run over every scenario and
// judged by the checker against the recorded results; it is killed when any scenario
// tells it apart. Mutants are our own reference's code, so they run on the local
// python3, not in the sandbox: a problem has hundreds of mutant runs.
const Mutant = z.object({
  line: z.int(),
  kind: z.string(),
  source: z.string(),
});
export const MUTATION_GATE = 0.9;
const RUN_SECONDS = 5;

export type MutationScore = {
  total: number;
  killed: number;
  survivors: { line: number; kind: string }[];
};

// The reference's results, from verify (never re-read from a file that may be stale): one
// per scenario, in scenariosOf order.
export function mutationScore(
  dir: string,
  options: { exec: string; expected: Expected },
): MutationScore {
  const problem = Problem.parse(
    JSON.parse(readFileSync(join(dir, "problem.json"), "utf8")),
  );
  const scenarios = scenariosOf(problem);
  if (options.expected.length !== scenarios.length)
    throw new Error(
      `${String(options.expected.length)} recorded results for ${String(scenarios.length)} scenarios`,
    );
  const harness = python(problem.interface);
  const reference = join(dir, "references", harness.solutionFile);
  const mutants = z
    .array(Mutant)
    .parse(
      JSON.parse(
        execFileSync(
          "python3",
          ["-I", join(import.meta.dirname, "../tools/mutants.py"), reference],
          { encoding: "utf8", maxBuffer: 64 << 20 },
        ),
      ),
    );
  const work = mkdtempSync(join(tmpdir(), `lld-mutation-${problem.slug}-`));
  const survivors: MutationScore["survivors"] = [];
  try {
    writeFileSync(join(work, harness.harnessFile), harness.harness);
    const checks = join(work, "checks.json");
    writeFileSync(checks, JSON.stringify(problem.checks ?? []));
    // Whether any scenario tells this source apart from the reference's results.
    const caught = (source: string) => {
      writeFileSync(join(work, harness.solutionFile), source);
      rmSync(join(work, "__pycache__"), { recursive: true, force: true });
      return scenarios.some((s, i) => {
        // -B: no bytecode cache. Two mutants of the same size written within a second
        // would otherwise share a stale .pyc, and the second would never really run.
        // cwd: the temp dir, so a mutant's own file I/O stays there.
        const run = spawnSync(
          "python3",
          ["-I", "-B", join(work, harness.harnessFile)],
          {
            cwd: work,
            input: JSON.stringify(s.scenario),
            encoding: "utf8",
            timeout: RUN_SECONDS * 1000,
            maxBuffer: 64 << 20,
          },
        );
        if (run.error !== undefined || run.status !== 0) return true;
        const want = options.expected[i];
        if (want === undefined)
          throw new Error(`no expected results for scenario ${String(i)}`);
        writeFileSync(join(work, "scenario.json"), JSON.stringify(s.scenario));
        writeFileSync(
          join(work, "expected.json"),
          JSON.stringify(want.results),
        );
        writeFileSync(join(work, "stdout.txt"), run.stdout);
        const check = spawnSync(options.exec, [
          "check",
          "--scenario",
          join(work, "scenario.json"),
          "--expected",
          join(work, "expected.json"),
          "--stdout",
          join(work, "stdout.txt"),
          "--checks",
          checks,
        ]);
        // 0 passes and 2 is a mismatch (caught); anything else is the tool's own fault.
        if (
          check.error !== undefined ||
          (check.status !== 0 && check.status !== 2)
        )
          throw new Error(
            `exec check failed (${String(check.status)}): ${String(check.stderr)}`,
          );
        return check.status === 2;
      });
    };
    // The reference itself first, run this same way: if it isn't passed here, every
    // mutant would look caught and the score would mean nothing.
    if (caught(readFileSync(reference, "utf8")))
      throw new Error(
        "the unmutated reference doesn't pass on the local python3: mutation can't be scored",
      );
    for (const m of mutants)
      if (!caught(m.source)) survivors.push({ line: m.line, kind: m.kind });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return {
    total: mutants.length,
    killed: mutants.length - survivors.length,
    survivors,
  };
}
