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
import { type Expected, Problem, scenariosOf } from "./problem";
import { randomScenario } from "./random";
import { ResultLine, type Scenario } from "./scenario";
import { fits, parseType } from "./types";

// P5-W30-S01 (LLDQ-2, EXEC-4; Q-P5-07): a problem's publication step. The Python
// reference, the canonical one (LLDQ-2), is run over every scenario through the real
// engine and its results recorded as expected.json; every other language's reference
// is then run and held to them by the Go checker. Any disagreement, or any reference
// outside the problem's limits, fails verification.

// Runs of each concurrency scenario, per language (P5-W30-S02b).
const RUNS = 3;

// The engine's answer, read at the boundary: another process's output.
const RunOutput = z.object({
  verdict: z.string(),
  stdout: z.string(),
  stderr: z.string(),
});
type RunOutput = z.infer<typeof RunOutput>;

export function verify(
  dir: string,
  options: {
    exec: string;
    mode: "write" | "check";
    // Seeded random scenarios, recorded from the Python reference and held to it in
    // every other language (LLDQ-3); never stored.
    random?: number;
  },
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
    const where = (s: { layer: string; index: number }) =>
      `${s.layer} ${String(s.index)}`;
    // P5-W30-S02b: a concurrency scenario must give the same results on every run, in
    // every language; one that doesn't is judged on timing, not on the code.
    const runs = (layer: string) => (layer === "concurrency" ? RUNS : 1);

    // The canonical results.
    const returns = new Map(
      problem.interface.methods.map((m) => [m.name, m.returns]),
    );
    const record = (s: {
      layer: string;
      index: number;
      scenario: Scenario;
    }): ResultLine[] => {
      const first = recordOnce(s);
      for (let k = 1; k < runs(s.layer); k++)
        if (!isDeepStrictEqual(first, recordOnce(s)))
          throw new Error(
            `python reference, ${where(s)}: flaky: the result depends on timing`,
          );
      return first;
    };
    const recordOnce = (s: {
      layer: string;
      index: number;
      scenario: Scenario;
    }): ResultLine[] => {
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
      return results;
    };
    const expected: Expected = scenarios.map((s) => ({
      layer: s.layer,
      index: s.index,
      results: record(s),
    }));
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
    // The written scenarios, then the random ones: a Python reference that fails on a
    // random scenario is a finding, not a crash of verify.
    const judged: {
      layer: string;
      index: number;
      scenario: Scenario;
      results: ResultLine[];
    }[] = scenarios.map((s, i) => {
      const want = expected[i];
      if (want === undefined)
        throw new Error(`no expected results for ${where(s)}`);
      return { ...s, results: want.results };
    });
    // Every string the scenarios pass, threads and map keys included: random calls then
    // hit the problem's real keys and words, not only its error paths.
    const strings = [
      ...new Set(
        scenarios
          .flatMap(({ scenario }) => [
            ...scenario.calls,
            ...(scenario.concurrent?.threads.flat() ?? []),
          ])
          .flatMap((c) => wordsIn(c.args)),
      ),
    ].sort();
    for (let k = 0; k < (options.random ?? 0); k++) {
      const s = {
        layer: "random",
        index: k,
        scenario: randomScenario(problem.interface, k + 1, { strings }),
      };
      try {
        judged.push({ ...s, results: record(s) });
      } catch (error) {
        failures.push(String(error instanceof Error ? error.message : error));
      }
    }
    const judge = (
      language: string,
      s: (typeof judged)[number],
    ): string | undefined => {
      const r = run(language, s.scenario);
      if (r.verdict !== "ok")
        return `${language} reference, ${where(s)}: ${r.verdict}\n${r.stderr.slice(0, 2000)}`;
      const files = {
        scenario: join(work, "scenario.json"),
        expected: join(work, "expected-one.json"),
        stdout: join(work, "stdout.txt"),
      };
      writeFileSync(files.scenario, JSON.stringify(s.scenario));
      writeFileSync(files.expected, JSON.stringify(s.results));
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
        return undefined;
      } catch (error) {
        const e = error as { status?: number; stdout?: Buffer };
        // Exit 2 is a mismatch; anything else is the problem's or the tool's fault.
        if (e.status !== 2) throw error;
        return `${language} reference, ${where(s)}: ${String(e.stdout ?? "").trim()}`;
      }
    };
    for (const language of Object.keys(GENERATORS).filter(
      (l) => l !== "python",
    ))
      for (const s of judged)
        for (let k = 0; k < runs(s.layer); k++) {
          const failure = judge(language, s);
          if (failure === undefined) continue;
          // One failure per scenario is enough; more runs would repeat it.
          failures.push(failure);
          break;
        }
    return { failures, expected };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function wordsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(wordsIn);
  if (value !== null && typeof value === "object")
    return Object.entries(value).flatMap(([k, v]) => [k, ...wordsIn(v)]);
  return [];
}
