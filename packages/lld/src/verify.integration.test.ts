import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { MUTATION_GATE, mutationScore } from "./mutation";
import { verify } from "./verify";

// P5-W30-S01 (LLDQ-2, EXEC-4): verification on the fixture problem, in the real sandbox
// and with the real checker. Needs Docker and Go: EXEC_INTEGRATION=1.
const integration = process.env["EXEC_INTEGRATION"] === "1";
// Every reference over every scenario, in the sandbox: minutes, not seconds.
const SLOW = 600_000;
const repo = join(import.meta.dirname, "../../..");
const fixture = join(import.meta.dirname, "../fixtures/problems/inventory");
let exec = "";
const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

beforeAll(() => {
  if (!integration) return;
  const build = mkdtempSync(join(tmpdir(), "lld-exec-"));
  made.push(build);
  exec = join(build, "exec");
  execFileSync("go", ["build", "-o", exec, "."], {
    cwd: join(repo, "services/exec"),
  });
}, SLOW);

const copy = () => {
  const root = mkdtempSync(join(tmpdir(), "lld-problem-"));
  made.push(root);
  const dir = join(root, "inventory");
  cpSync(fixture, dir, { recursive: true });
  return dir;
};

test.runIf(integration)(
  "every reference agrees; expected.json is written, then current",
  () => {
    const dir = copy();
    const written = verify(dir, { exec, mode: "write" });
    expect(written.failures).toEqual([]);
    // One recording per scenario, in order: visible, hidden, then concurrency.
    const layers = (
      JSON.parse(readFileSync(join(dir, "problem.json"), "utf8")) as {
        layers: {
          visible: unknown[];
          hidden: unknown[];
          concurrency: unknown[];
        };
      }
    ).layers;
    expect(
      written.expected.map((e) => `${e.layer} ${String(e.index)}`),
    ).toEqual([
      ...layers.visible.map((_, i) => `visible ${String(i)}`),
      ...layers.hidden.map((_, i) => `hidden ${String(i)}`),
      ...layers.concurrency.map((_, i) => `concurrency ${String(i)}`),
    ]);
    // Four threads of a hundred adds each, all counted: the references lock.
    expect(written.expected.at(-1)?.results[1]).toEqual({
      call: 1,
      value: 400,
    });
    expect(verify(dir, { exec, mode: "check" }).failures).toEqual([]);
  },
  SLOW,
);

test.runIf(integration)(
  "a reference that disagrees fails verification",
  () => {
    const dir = copy();
    verify(dir, { exec, mode: "write" });
    const js = join(dir, "references/solution.js");
    writeFileSync(
      js,
      readFileSync(js, "utf8").replace(
        "return this.counts.get(item) ?? null;",
        "return 0;",
      ),
    );
    const { failures } = verify(dir, { exec, mode: "check" });
    expect(failures.length).toBeGreaterThan(0);
    expect(
      failures.filter((f) => !f.startsWith("javascript reference")),
    ).toEqual([]);
    expect(failures[0]).toContain("wrong value");
  },
  SLOW,
);

test.runIf(integration)(
  "a stale expected.json is caught",
  () => {
    const dir = copy();
    writeFileSync(join(dir, "expected.json"), "[]\n");
    expect(verify(dir, { exec, mode: "check" }).failures[0]).toMatch(/stale/);
  },
  SLOW,
);

test.runIf(integration)(
  "a missing expected.json is reported, not thrown",
  () => {
    const dir = copy();
    rmSync(join(dir, "expected.json"), { force: true });
    expect(verify(dir, { exec, mode: "check" }).failures[0]).toMatch(/missing/);
  },
  SLOW,
);

// P5-W30-S02 (LLDQ-2, LLDQ-3): random scenarios every reference agrees on, and a mutation
// score the fixture's tests clear, while a thin test set doesn't.
test.runIf(integration)(
  "every reference agrees on random scenarios",
  () => {
    const dir = copy();
    expect(verify(dir, { exec, mode: "check", random: 3 }).failures).toEqual(
      [],
    );
  },
  SLOW,
);

test.runIf(integration)(
  "the fixture's tests catch at least 90% of the reference's mutants; thin tests don't",
  () => {
    const dir = copy();
    const { expected } = verify(dir, { exec, mode: "check" });
    const score = mutationScore(dir, { exec, expected });
    expect(score.killed / score.total).toBeGreaterThanOrEqual(MUTATION_GATE);
    const thin = copy();
    const problem = JSON.parse(
      readFileSync(join(thin, "problem.json"), "utf8"),
    ) as {
      layers: { hidden: unknown[] };
    };
    problem.layers.hidden = problem.layers.hidden.slice(0, 1);
    writeFileSync(join(thin, "problem.json"), JSON.stringify(problem));
    const rewritten = verify(thin, { exec, mode: "write" });
    expect(rewritten.failures).toEqual([]);
    const weak = mutationScore(thin, { exec, expected: rewritten.expected });
    expect(weak.killed / weak.total).toBeLessThan(MUTATION_GATE);
  },
  SLOW,
);

// P5-W30-S02b (LLDQ-3, §6.5): the concurrency layer catches a race. Without its lock,
// Java's add loses updates (or throws mid-update) when four threads collide; across
// verify's runs that shows as a wrong stock.
test.runIf(integration)(
  "an unlocked reference fails the concurrency layer",
  () => {
    const dir = copy();
    const java = join(dir, "references/Inventory.java");
    const source = readFileSync(java, "utf8");
    // No lock, and no print inside add: the window between read and write stays open.
    const unlocked = source
      .replace("public synchronized long add(", "public long add(")
      .replace('System.out.println("debug: add " + item);', "");
    expect(unlocked).not.toBe(source);
    writeFileSync(java, unlocked);
    const caught = Array.from({ length: 5 }).some(() =>
      verify(dir, { exec, mode: "check" }).failures.some((f) =>
        f.startsWith("java reference, concurrency 0"),
      ),
    );
    expect(caught).toBe(true);
  },
  SLOW,
);
