import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { GENERATORS } from "./generate/index";
import { Problem, scenariosOf } from "./problem";

// P5-W30-S03 (LLDQ-1 to LLDQ-4, Q-P5-08): every problem in problems/lld is whole: a
// valid problem.json named for its directory, a reference in every language, a
// concurrency layer, an expected.json that matches its scenarios, and a statement marked
// PROVISIONAL until the owner reviews it. Whether the references agree is the sandbox's
// job (problems.integration.test.ts).
const problemsDir = join(import.meta.dirname, "../../../problems/lld");
const slugs = readdirSync(problemsDir).filter((s) => !s.startsWith("."));

test("there are problems", () => {
  expect(slugs.length).toBeGreaterThanOrEqual(3);
});

for (const slug of slugs)
  test(`${slug} is a whole problem`, () => {
    const dir = join(problemsDir, slug);
    const problem = Problem.parse(
      JSON.parse(readFileSync(join(dir, "problem.json"), "utf8")),
    );
    expect(problem.slug).toBe(slug);
    expect(problem.layers.concurrency?.length ?? 0).toBeGreaterThan(0);
    for (const generate of Object.values(GENERATORS)) {
      const file = generate(problem.interface).solutionFile;
      expect(existsSync(join(dir, "references", file)), file).toBe(true);
    }
    const expected = JSON.parse(
      readFileSync(join(dir, "expected.json"), "utf8"),
    ) as { layer: string; index: number; results: unknown[] }[];
    const scenarios = scenariosOf(problem);
    expect(expected.map((e) => `${e.layer} ${String(e.index)}`)).toEqual(
      scenarios.map((s) => `${s.layer} ${String(s.index)}`),
    );
    expected.forEach((e, i) => {
      expect(e.results).toHaveLength(scenarios[i]?.scenario.calls.length ?? -1);
    });
    expect(readFileSync(join(dir, "statement.md"), "utf8")).toMatch(
      /PROVISIONAL/,
    );
  });
