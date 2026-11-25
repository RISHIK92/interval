import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { GENERATORS } from "./generate/index";
import { parseHints } from "./hints";
import { Expected, Problem, scenariosOf } from "./problem";

// P5-W30-S03 (LLDQ-1 to LLDQ-4, Q-P5-08): every problem in problems/lld is whole: a
// valid problem.json named for its directory, a reference in every language, an
// expected.json that matches its scenarios, and a statement marked PROVISIONAL until
// the owner reviews it. A battle problem's concurrency layer is the schema's rule.
// Whether the references agree is the sandbox's job (problems.integration.test.ts).
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
    for (const generate of Object.values(GENERATORS)) {
      const file = generate(problem.interface).solutionFile;
      expect(existsSync(join(dir, "references", file)), file).toBe(true);
    }
    const expected = Expected.parse(
      JSON.parse(readFileSync(join(dir, "expected.json"), "utf8")),
    );
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
    // P5-W31-S02a: an extension is revealed with its own statement.
    expect(existsSync(join(dir, "extension.md"))).toBe(
      problem.extension !== undefined,
    );
    // P5-W33 (Q-P5-13): an AI-mode problem's interviewer answers from its notes.
    expect(existsSync(join(dir, "interviewer.md"))).toBe(
      problem.battleMode === "ai",
    );
    // Q-WD-17: every problem's three hint levels, PROVISIONAL until reviewed.
    const hints = readFileSync(join(dir, "hints.md"), "utf8");
    expect(hints).toMatch(/PROVISIONAL/);
    expect(parseHints(hints)).toHaveLength(3);
  });

// ADR-0048 (Q-WD-28): the pools stay apart for good. The practice catalog grows
// (Q-WD-30); the battle pool is these, and a problem never moves between them.
// The problems that parse; one that doesn't fails its own test above.
const problems = slugs.flatMap((slug) => {
  const parsed = Problem.safeParse(
    JSON.parse(readFileSync(join(problemsDir, slug, "problem.json"), "utf8")),
  );
  return parsed.success ? [parsed.data] : [];
});

test("the battle pool is its own", () => {
  expect(
    problems
      .filter((p) => p.pool === "battle")
      .map((p) => p.slug)
      .sort(),
  ).toEqual([
    "bank-ledger",
    "file-system",
    "leaderboard",
    "order-book",
    "rate-limiter",
    "task-scheduler",
    "url-shortener",
    "vending-machine",
  ]);
  for (const slug of [
    "elevator-system",
    "lru-cache",
    "meeting-rooms",
    "parking-lot",
  ])
    expect(problems.find((p) => p.slug === slug)?.pool).toBe("practice");
});

// Q-WD-30: that a practice problem's concepts are live in the concept graph is checked
// with the seed's own loader, in workers/jobs/tests/test_lld_problem_concepts.py.
