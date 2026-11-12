import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { z } from "zod";
import { Interface } from "./interface";
import { randomScenario } from "./random";
import { checkScenario } from "./scenario";

// P5-W30-S02 (LLDQ-2, LLDQ-3): random scenarios and mutants, the two halves of a
// problem's own testing.
const fixture = join(import.meta.dirname, "../fixtures/problems/inventory");
const iface = Interface.parse(
  (
    JSON.parse(readFileSync(join(fixture, "problem.json"), "utf8")) as {
      interface: unknown;
    }
  ).interface,
);

test("a seed always gives the same scenario, and every scenario fits its interface", () => {
  expect(randomScenario(iface, 7)).toEqual(randomScenario(iface, 7));
  expect(randomScenario(iface, 7)).not.toEqual(randomScenario(iface, 8));
  for (let seed = 1; seed <= 50; seed++) {
    const s = randomScenario(iface, seed);
    expect(s.calls[0]?.method).toBe("new");
    expect(checkScenario(iface, s)).toEqual([]);
  }
});

test("the mutator gives only valid Python, of every kind its operators make", () => {
  const sample = `
class C:
    def __init__(self, n):
        self.n = n
        self.ok = True

    def f(self, x):
        if x < self.n and not self.ok:
            return x + 1
        while x > 0 or x == 3:
            x -= 1
        return x in [1, 2]
`;
  const mutants = z
    .array(z.object({ line: z.int(), kind: z.string(), source: z.string() }))
    .parse(
      JSON.parse(
        execFileSync(
          "python3",
          [
            "-I",
            join(import.meta.dirname, "../tools/mutants.py"),
            "/dev/stdin",
          ],
          {
            input: sample,
            encoding: "utf8",
          },
        ),
      ),
    );
  const kinds = new Set(mutants.map((m) => m.kind));
  for (const k of [
    "compare",
    "arith",
    "augassign",
    "boolop",
    "bool",
    "constant+1",
    "constant-1",
    "not",
    "return",
    "condition",
  ])
    expect(kinds, k).toContain(k);
  // Each one still compiles, and none is the original.
  const check = execFileSync(
    "python3",
    [
      "-I",
      "-c",
      "import json,sys,ast\nms=json.load(sys.stdin)\nfor m in ms: compile(m['source'],'m','exec')\nprint(len(set(m['source'] for m in ms)))",
    ],
    { input: JSON.stringify(mutants), encoding: "utf8" },
  );
  expect(Number(check.trim())).toBe(mutants.length);
  // Each changes exactly one line of the original, the line it names; a dropped "not"
  // leaves no stray unary "+".
  const original = execFileSync(
    "python3",
    [
      "-I",
      "-c",
      "import ast,sys; print(ast.unparse(ast.parse(sys.stdin.read())))",
    ],
    {
      input: sample,
      encoding: "utf8",
    },
  ).split("\n");
  for (const m of mutants) {
    const lines = m.source.split("\n");
    const changed = lines.flatMap((l, i) => (l === original[i] ? [] : [i]));
    expect(changed, `${m.kind} at ${String(m.line)}`).toHaveLength(1);
    if (m.kind === "not") expect(m.source).not.toMatch(/\+self/);
  }
  // A constant inside a raise is never mutated.
  const raises = execFileSync(
    "python3",
    ["-I", join(import.meta.dirname, "../tools/mutants.py"), "/dev/stdin"],
    {
      input: "def f(x):\n    raise ValueError(3)\n",
      encoding: "utf8",
    },
  );
  expect(JSON.parse(raises)).toEqual([]);
});
