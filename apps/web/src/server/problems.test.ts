import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Expected, Problem } from "@interval/lld";
import { expect, test } from "vitest";
import type { FileStore, LoadedProblem, ProblemStore } from "./ports";
import { type ProblemSource, loadProblems, privateLayers } from "./problems";

// P5-W31-S01 (LLDQ-4, DB-6): problems/lld into Postgres and the private bucket. The row
// holds only what a player may see; the hidden layers go to the bucket, first.
const dir = join(import.meta.dirname, "../../../../problems/lld/lru-cache");
const source = (): ProblemSource => ({
  problem: Problem.parse(
    JSON.parse(readFileSync(join(dir, "problem.json"), "utf8")),
  ),
  statement: readFileSync(join(dir, "statement.md"), "utf8"),
  extensionStatement: readFileSync(join(dir, "extension.md"), "utf8"),
  expected: Expected.parse(
    JSON.parse(readFileSync(join(dir, "expected.json"), "utf8")),
  ),
});

function fakes() {
  const order: string[] = [];
  const rows = new Map<string, LoadedProblem & { retired: boolean }>();
  const objects = new Map<string, string>();
  const store: ProblemStore = {
    hashes: () =>
      Promise.resolve(
        new Map(
          [...rows.values()]
            .filter((r) => !r.retired)
            .map((r) => [r.slug, r.contentHash]),
        ),
      ),
    save: (p) => {
      order.push(`row ${p.slug}`);
      rows.set(p.slug, { ...p, retired: false });
      return Promise.resolve();
    },
    retire: (slugs) => {
      for (const s of slugs) {
        const r = rows.get(s);
        if (r !== undefined) r.retired = true;
      }
      return Promise.resolve();
    },
  };
  const files: FileStore = {
    put: (key, bytes) => {
      order.push(`file ${key}`);
      objects.set(key, new TextDecoder().decode(bytes));
      return Promise.resolve();
    },
    get: () => Promise.resolve(null),
    remove: () => Promise.resolve(),
  };
  return { order, rows, objects, store, files };
}

test("a new problem: its hidden layers to the bucket first, then a row without them", async () => {
  const f = fakes();
  const report = await loadProblems([source()], f);
  expect(report).toEqual({
    added: ["lru-cache"],
    updated: [],
    unchanged: [],
    retired: [],
  });
  const row = f.rows.get("lru-cache");
  if (row === undefined) throw new Error("no row");
  expect(f.order).toEqual([`file ${row.privateKey}`, "row lru-cache"]);
  expect(row.privateKey).toBe(`lld/problems/lru-cache/${row.contentHash}.json`);
  const p = source().problem;
  expect(row.visible.map((v) => v.scenario)).toEqual(p.layers.visible);
  // Nothing hidden in the row: no hidden or concurrency scenario, no hidden result.
  const text = JSON.stringify(row);
  for (const s of [...p.layers.hidden, ...(p.layers.concurrency ?? [])])
    expect(text).not.toContain(JSON.stringify(s.calls));
  const judged = JSON.parse(f.objects.get(row.privateKey) ?? "null") as unknown;
  expect(judged).toEqual(privateLayers(source()));
});

test("an unchanged problem keeps its row, and its file is put back; a changed one gets a new key", async () => {
  const f = fakes();
  await loadProblems([source()], f);
  const first = f.rows.get("lru-cache")?.privateKey;
  f.order.length = 0;
  f.objects.clear();
  expect((await loadProblems([source()], f)).unchanged).toEqual(["lru-cache"]);
  expect(f.order).toEqual([`file ${String(first)}`]);
  expect(f.objects.has(String(first))).toBe(true);
  const changed = source();
  changed.statement += "\nA clarification.\n";
  expect((await loadProblems([changed], f)).updated).toEqual(["lru-cache"]);
  expect(f.rows.get("lru-cache")?.privateKey).not.toBe(first);
});

test("a problem gone from disk is retired, and comes back when loaded again", async () => {
  const f = fakes();
  await loadProblems([source()], f);
  expect((await loadProblems([], f)).retired).toEqual(["lru-cache"]);
  expect(f.rows.get("lru-cache")?.retired).toBe(true);
  expect((await loadProblems([source()], f)).added).toEqual(["lru-cache"]);
  expect(f.rows.get("lru-cache")?.retired).toBe(false);
});

test("one problem whose expected results don't match its scenarios loads nothing", async () => {
  const f = fakes();
  const bad = source();
  bad.expected = bad.expected.slice(1);
  await expect(loadProblems([source(), bad], f)).rejects.toThrow(
    /expected\.json/,
  );
  expect(f.order).toEqual([]);
});

test("a failed bucket write leaves no row", async () => {
  const f = fakes();
  f.files.put = () => Promise.reject(new Error("bucket down"));
  await expect(loadProblems([source()], f)).rejects.toThrow(/bucket down/);
  expect(f.rows.size).toBe(0);
});

// P5-W31-S02a: an extension round's statement and interface go in the row, for the
// reveal; its scenarios and results only to the bucket.
test("an extension: its text and interface in the row, its scenarios only in the bucket", async () => {
  const f = fakes();
  const fixture = join(
    import.meta.dirname,
    "../../../../packages/lld/fixtures/problems/inventory",
  );
  const read = (name: string) => readFileSync(join(fixture, name), "utf8");
  const withExtension: ProblemSource = {
    problem: Problem.parse(JSON.parse(read("problem.json"))),
    statement: read("statement.md"),
    extensionStatement: read("extension.md"),
    expected: Expected.parse(JSON.parse(read("expected.json"))),
  };
  await loadProblems([withExtension], f);
  const row = f.rows.get("inventory");
  if (row === undefined) throw new Error("no row");
  expect(row.extension?.statement).toMatch(/reservations/);
  expect(row.extension?.interface.methods.map((m) => m.name)).toContain(
    "reserve",
  );
  for (const s of withExtension.problem.extension?.scenarios ?? [])
    expect(JSON.stringify(row)).not.toContain(JSON.stringify(s.calls));
  // Nor their results: the row's only results are the visible layer's.
  const visibleCount = withExtension.problem.layers.visible.length;
  expect(row.visible).toHaveLength(visibleCount);
  expect(row.visible.map((v) => v.results)).toEqual(
    withExtension.expected.slice(0, visibleCount).map((e) => e.results),
  );
  const judged = privateLayers(withExtension).scenarios.filter(
    (s) => s.layer === "extension",
  );
  expect(judged).toHaveLength(
    withExtension.problem.extension?.scenarios.length ?? -1,
  );
  // Without its extension.md, nothing loads.
  const missing: ProblemSource = {
    problem: withExtension.problem,
    statement: withExtension.statement,
    expected: withExtension.expected,
  };
  await expect(loadProblems([missing], fakes())).rejects.toThrow(
    /extension\.md/,
  );
});

test("an empty extension.md loads nothing", async () => {
  const fixture = join(
    import.meta.dirname,
    "../../../../packages/lld/fixtures/problems/inventory",
  );
  const read = (name: string) => readFileSync(join(fixture, name), "utf8");
  await expect(
    loadProblems(
      [
        {
          problem: Problem.parse(JSON.parse(read("problem.json"))),
          statement: read("statement.md"),
          extensionStatement: "  \n",
          expected: Expected.parse(JSON.parse(read("expected.json"))),
        },
      ],
      fakes(),
    ),
  ).rejects.toThrow(/extension\.md is empty/);
});
