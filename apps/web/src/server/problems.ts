import { createHash } from "node:crypto";
import { type Expected, type Problem, scenariosOf } from "@interval/lld";
import type { FileStore, LoadedProblem, ProblemStore } from "./ports";

// P5-W31-S01 (LLDQ-4, DB-6): LLD battle problems, from problems/lld into Postgres and
// the private bucket. Postgres gets what a player may see (the statement, the
// interface, the visible scenarios with their results); the bucket gets every layer
// with its expected results, for the judge. The bucket is written first, at a key named
// by the content, so a row never points at a file that isn't there. The file is written
// on every load, even for an unchanged problem (its bytes are the same, at the same
// key), so a lost bucket is repaired by loading again. Superseded files are kept:
// battles played on an older version may need them.
//
// Problems load one at a time: a failure partway leaves the earlier ones loaded and
// nothing retired, and loading again finishes the job.

export type ProblemSource = {
  problem: Problem;
  statement: string;
  expected: Expected;
};

type LoadReport = {
  added: string[];
  updated: string[];
  unchanged: string[];
  retired: string[];
};

// Each scenario of every layer, in scenariosOf order, with its expected results: what
// a judge job is built from (W31).
export function privateLayers(source: ProblemSource) {
  return {
    slug: source.problem.slug,
    scenarios: scenariosOf(source.problem).map((s, i) => {
      const results = source.expected[i]?.results;
      // checkExpected has paired them; a judge file without results would pass anything.
      if (results === undefined)
        throw new Error(`${s.layer} ${String(s.index)}: no expected results`);
      return { layer: s.layer, index: s.index, scenario: s.scenario, results };
    }),
  };
}

// expected.json comes from verify, which records one entry per scenario, in order; a
// file that disagrees is stale or hand-edited, and nothing is loaded from it.
function checkExpected({ problem, expected }: ProblemSource): void {
  const scenarios = scenariosOf(problem);
  const where = (s: { layer: string; index: number }) =>
    `${s.layer} ${String(s.index)}`;
  if (
    expected.length !== scenarios.length ||
    scenarios.some((s, i) => {
      const e = expected[i];
      return (
        e === undefined ||
        where(e) !== where(s) ||
        e.results.length !== s.scenario.calls.length
      );
    })
  )
    throw new Error(
      `${problem.slug}: expected.json doesn't match its scenarios; run verify`,
    );
}

function rowOf(source: ProblemSource, contentHash: string): LoadedProblem {
  const { problem, statement } = source;
  const visible = privateLayers(source)
    .scenarios.filter((s) => s.layer === "visible")
    .map((s) => ({ scenario: s.scenario, results: s.results }));
  return {
    slug: problem.slug,
    title: problem.title,
    difficulty: problem.difficulty,
    statement,
    interface: problem.interface,
    checks: problem.checks ?? [],
    limits: problem.limits,
    visible,
    privateKey: `lld/problems/${problem.slug}/${contentHash}.json`,
    contentHash,
  };
}

export async function loadProblems(
  sources: ProblemSource[],
  { store, files }: { store: ProblemStore; files: FileStore },
): Promise<LoadReport> {
  // Every problem is checked before any is loaded: a bad one loads nothing.
  for (const s of sources) checkExpected(s);
  const report: LoadReport = {
    added: [],
    updated: [],
    unchanged: [],
    retired: [],
  };
  const live = await store.hashes();
  for (const source of sources) {
    const slug = source.problem.slug;
    const hash = createHash("sha256")
      .update(
        JSON.stringify([source.problem, source.statement, source.expected]),
      )
      .digest("hex");
    const was = live.get(slug);
    const row = rowOf(source, hash);
    await files.put(
      row.privateKey,
      new TextEncoder().encode(JSON.stringify(privateLayers(source))),
      "application/json",
    );
    if (was === hash) {
      report.unchanged.push(slug);
      continue;
    }
    await store.save(row);
    (was === undefined ? report.added : report.updated).push(slug);
  }
  const onDisk = new Set(sources.map((s) => s.problem.slug));
  report.retired = [...live.keys()].filter((slug) => !onDisk.has(slug)).sort();
  if (report.retired.length > 0) await store.retire(report.retired);
  return report;
}
