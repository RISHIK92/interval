import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { Expected, Problem, scenariosOf } from "./problem";
import { recorded, verify } from "./verify";

// Q-WD-17: expected.json holds what a submission is held to, never where the reference
// raised its errors.
test("a recorded error keeps no line; a value is kept as it is", () => {
  expect(recorded({ call: 2, error: "ValueError: full", line: 23 })).toEqual({
    call: 2,
    error: "ValueError: full",
  });
  expect(recorded({ call: 1, value: [1, "a"] })).toEqual({
    call: 1,
    value: [1, "a"],
  });
});

// Owner, 2026-11-26: a reference whose code took too long to compile fails verification
// with that verdict, scenario by scenario, like any verdict but ok.
test("a reference past its compile budget fails verification", () => {
  const dir = join(import.meta.dirname, "../fixtures/problems/inventory");
  const problem = Problem.parse(
    JSON.parse(readFileSync(join(dir, "problem.json"), "utf8")),
  );
  const expected = Expected.parse(
    JSON.parse(readFileSync(join(dir, "expected.json"), "utf8")),
  );
  const work = mkdtempSync(join(tmpdir(), "lld-verify-test-"));
  try {
    // A stand-in for the engine: each scenario's recorded results, and C++ never compiling
    // in time.
    const answers = Object.fromEntries(
      scenariosOf(problem).map((s, i) => [
        JSON.stringify(s.scenario),
        (expected[i]?.results ?? []).map((l) => JSON.stringify(l)).join("\n"),
      ]),
    );
    writeFileSync(join(work, "answers.json"), JSON.stringify(answers));
    const exec = join(work, "exec");
    writeFileSync(
      exec,
      `#!${process.execPath}
const { readFileSync } = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "check") process.exit(0);
const language = args[args.indexOf("--language") + 1];
const answers = JSON.parse(readFileSync(${JSON.stringify(join(work, "answers.json"))}, "utf8"));
const stdin = readFileSync(0, "utf8");
console.log(JSON.stringify(language === "cpp"
  ? { verdict: "compile_time_limit", stdout: "", stderr: "" }
  : { verdict: "ok", stdout: answers[stdin] + "\\n", stderr: "" }));
`,
    );
    chmodSync(exec, 0o755);
    const { failures } = verify(dir, { exec, mode: "check" });
    expect(failures).toHaveLength(scenariosOf(problem).length);
    for (const f of failures)
      expect(f).toMatch(/^cpp reference, \w+ \d+: compile_time_limit\n$/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  // A process per run, every language over every scenario.
}, 60_000);
