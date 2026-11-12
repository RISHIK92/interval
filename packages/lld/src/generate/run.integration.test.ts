import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { Interface } from "../interface";
import { ResultLine } from "../scenario";
import { GENERATORS, runFiles } from "./index";
import { broken, expected, inventory, scenario } from "./inventory.fixture";

// P5-W29-S02 (LLDQ-1, EXEC-2): each language's harness, with a reference solution, run
// in the real sandbox; all six print the same results.
// The execution engine's binary, with its `run` and `check` commands (Velox's, ADR-0041
// PROPOSED); these tests skip without it.
const exec = process.env["EXEC_BIN"] ?? "";
const integration = exec !== "";
// A compile and a run in the sandbox, cold on a CI runner: well past vitest's 5 s.
const SLOW = 300_000;
const fixtures = join(
  import.meta.dirname,
  "../../fixtures/problems/inventory/references",
);
const iface = Interface.parse(inventory);

function run(
  language: string,
  files: Record<string, string>,
  input: object = scenario,
) {
  const dir = mkdtempSync(join(tmpdir(), `lld-${language}-`));
  for (const [name, body] of Object.entries(files))
    writeFileSync(join(dir, name), body);
  const out = execFileSync(
    exec,
    ["run", "--language", language, "--dir", dir],
    {
      input: JSON.stringify(input),
      encoding: "utf8",
      timeout: 120_000,
    },
  );
  return JSON.parse(out) as { verdict: string; stdout: string; stderr: string };
}

const SOLUTIONS: Record<string, string> = {
  python: "solution.py",
  javascript: "solution.js",
  typescript: "solution.ts",
  java: "Inventory.java",
  cpp: "solution.hpp",
  go: "solution.go",
};

for (const language of Object.keys(GENERATORS)) {
  test.runIf(integration)(
    `${language}: the reference solution's results, every call`,
    () => {
      const solution = readFileSync(
        join(fixtures, SOLUTIONS[language] ?? ""),
        "utf8",
      );
      const r = run(language, runFiles(language, iface, solution));
      expect(r.verdict, r.stderr).toBe("ok");
      const lines = r.stdout
        .trimEnd()
        .split("\n")
        .map((l) => ResultLine.parse(JSON.parse(l)));
      expect(
        lines.map((l) => ("error" in l ? { call: l.call, error: true } : l)),
      ).toEqual(expected);
      // The solution's own print went to stderr, never into the results.
      expect(r.stdout).not.toContain("debug");
      expect(r.stderr).toContain("debug: add");
    },
    SLOW,
  );

  test.runIf(integration)(
    `${language}: a failed constructor gives error lines, not a crash`,
    () => {
      const solution = readFileSync(
        join(fixtures, SOLUTIONS[language] ?? ""),
        "utf8",
      );
      const r = run(language, runFiles(language, iface, solution), broken);
      expect(r.verdict, r.stderr).toBe("ok");
      const lines = r.stdout
        .trimEnd()
        .split("\n")
        .map((l) => ResultLine.parse(JSON.parse(l)));
      expect(lines.map((l) => "error" in l)).toEqual([true, true]);
    },
    SLOW,
  );

  test.runIf(integration)(
    `${language}: the starter compiles, and its methods give errors`,
    () => {
      const g = GENERATORS[language]?.(iface);
      if (g === undefined) throw new Error(language);
      const r = run(language, runFiles(language, iface, g.starter));
      expect(r.verdict, r.stderr).toBe("ok");
      const lines = r.stdout
        .trimEnd()
        .split("\n")
        .map((l) => ResultLine.parse(JSON.parse(l)));
      expect(lines).toHaveLength(scenario.calls.length);
      expect(lines[0]).toEqual({ call: 0, value: null });
      expect(lines.slice(1).every((l) => "error" in l)).toBe(true);
    },
    SLOW,
  );
}
