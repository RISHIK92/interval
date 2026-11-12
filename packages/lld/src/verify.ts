import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { GENERATORS, runFiles } from "./generate/index";
import { Problem, scenariosOf } from "./problem";
import { ResultLine, type Scenario } from "./scenario";
import { fits, parseType } from "./types";

// P5-W30-S01 (LLDQ-2, EXEC-4; Q-P5-07): a problem's publication step. The Python
// reference, the canonical one (LLDQ-2), is run over every scenario through the real
// engine and its results recorded as expected.json; every other language's reference
// is then run and held to them by the Go checker. Any disagreement, or any reference
// outside the problem's limits, fails verification.

export type Expected = {
  layer: "visible" | "hidden";
  index: number;
  results: ResultLine[];
}[];

// The engine's answer, read at the boundary: another process's output.
const RunOutput = z.object({
  verdict: z.string(),
  stdout: z.string(),
  stderr: z.string(),
});
type RunOutput = z.infer<typeof RunOutput>;

export function verify(
  dir: string,
  options: { exec: string; mode: "write" | "check" },
): { failures: string[]; expected: Expected } {
  const problem = Problem.parse(
    JSON.parse(readFileSync(join(dir, "problem.json"), "utf8")),
  );
  if (problem.slug !== basename(dir))
    throw new Error(
      `problem.json says "${problem.slug}", its directory is "${basename(dir)}"`,
    );
  const scenarios = scenariosOf(problem);
  const work = mkdtempSync(join(tmpdir(), `lld-verify-${problem.slug}-`));
  const failures: string[] = [];
  try {
    const run = (language: string, scenario: Scenario): RunOutput => {
      const generate = GENERATORS[language];
      if (generate === undefined)
        throw new Error(`no generator for ${language}`);
      const source = readFileSync(
        join(dir, "references", generate(problem.interface).solutionFile),
        "utf8",
      );
      const runDir = mkdtempSync(join(work, `${language}-`));
      for (const [name, body] of Object.entries(
        runFiles(language, problem.interface, source),
      ))
        writeFileSync(join(runDir, name), body);
      const out = execFileSync(
        options.exec,
        [
          "run",
          "--language",
          language,
          "--dir",
          runDir,
          "--seconds",
          String(problem.limits.seconds),
          "--memory",
          String(problem.limits.memoryMB),
        ],
        {
          input: JSON.stringify(scenario),
          encoding: "utf8",
          maxBuffer: 64 << 20,
        },
      );
      return RunOutput.parse(JSON.parse(out));
    };
    const where = (s: (typeof scenarios)[number]) =>
      `${s.layer} ${String(s.index)}`;

    // The canonical results.
    const returns = new Map(
      problem.interface.methods.map((m) => [m.name, m.returns]),
    );
    const expected: Expected = scenarios.map((s) => {
      const r = run("python", s.scenario);
      if (r.verdict !== "ok")
        throw new Error(
          `python reference, ${where(s)}: ${r.verdict}\n${r.stderr.slice(0, 2000)}`,
        );
      const results = r.stdout
        .trimEnd()
        .split("\n")
        .map((l) => ResultLine.parse(JSON.parse(l)));
      // The canonical results are checked before they are recorded: one line per call, in
      // order, each value of the type its method declares.
      if (results.length !== s.scenario.calls.length)
        throw new Error(
          `python reference, ${where(s)}: ${String(results.length)} results for ${String(s.scenario.calls.length)} calls`,
        );
      results.forEach((line, i) => {
        if (line.call !== i)
          throw new Error(
            `python reference, ${where(s)}: result ${String(i)} says call ${String(line.call)}`,
          );
        const method = s.scenario.calls[i]?.method ?? "";
        const declared = method === "new" ? "void" : returns.get(method);
        if (!("value" in line) || declared === undefined) return;
        const ok =
          declared === "void"
            ? line.value === null
            : fits(parseType(declared), line.value);
        if (!ok)
          throw new Error(
            `python reference, ${where(s)}: call ${String(i)} (${method}) returned a value that isn't its declared ${declared}`,
          );
      });
      return { layer: s.layer, index: s.index, results };
    });
    const file = join(dir, "expected.json");
    const text = `${JSON.stringify(expected, null, 2)}\n`;
    if (options.mode === "write") writeFileSync(file, text);
    else if (!existsSync(file))
      failures.push("expected.json is missing: run verify to write it");
    // Compared as JSON, so prettier's layout of the committed file never makes it stale.
    else if (
      !isDeepStrictEqual(JSON.parse(readFileSync(file, "utf8")), expected)
    )
      failures.push("expected.json is stale: run verify to rewrite it");

    // Every other reference, held to them by the checker.
    const checks = join(work, "checks.json");
    writeFileSync(checks, JSON.stringify(problem.checks ?? []));
    for (const language of Object.keys(GENERATORS).filter(
      (l) => l !== "python",
    ))
      scenarios.forEach((s, i) => {
        const r = run(language, s.scenario);
        if (r.verdict !== "ok") {
          failures.push(
            `${language} reference, ${where(s)}: ${r.verdict}\n${r.stderr.slice(0, 2000)}`,
          );
          return;
        }
        const files = {
          scenario: join(work, "scenario.json"),
          expected: join(work, "expected-one.json"),
          stdout: join(work, "stdout.txt"),
        };
        writeFileSync(files.scenario, JSON.stringify(s.scenario));
        writeFileSync(
          files.expected,
          JSON.stringify(expected[i]?.results ?? []),
        );
        writeFileSync(files.stdout, r.stdout);
        try {
          execFileSync(options.exec, [
            "check",
            "--scenario",
            files.scenario,
            "--expected",
            files.expected,
            "--stdout",
            files.stdout,
            "--checks",
            checks,
          ]);
        } catch (error) {
          const e = error as { status?: number; stdout?: Buffer };
          // Exit 2 is a mismatch; anything else is the problem's or the tool's fault.
          if (e.status !== 2) throw error;
          failures.push(
            `${language} reference, ${where(s)}: ${String(e.stdout ?? "").trim()}`,
          );
        }
      });
    return { failures, expected };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
