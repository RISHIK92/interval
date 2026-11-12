import { expect, test } from "vitest";
import { Interface } from "../interface";
import { GENERATORS, runFiles } from "./index";
import { inventory } from "./inventory.fixture";

// P5-W29-S02 (LLDQ-1): every language's harness dispatches through a generated switch,
// never reflection, and its starter declares every method with the mapped types.
const iface = Interface.parse(inventory);
const reflection = /getattr|getMethod|reflect\.|Reflect\.|eval\(|\bFunction\(/;

test("each harness has an arm for every method and no reflection", () => {
  for (const [language, generate] of Object.entries(GENERATORS)) {
    const g = generate(iface);
    expect(g.harness, language).not.toMatch(reflection);
    for (const m of ["new", ...iface.methods.map((x) => x.name)])
      expect(g.harness, `${language} ${m}`).toContain(`"${m}"`);
  }
});

test("each starter declares the class and every method", () => {
  for (const [language, generate] of Object.entries(GENERATORS)) {
    const g = generate(iface);
    expect(g.starter, language).toContain("Inventory");
    for (const m of iface.methods)
      expect(g.starter, `${language} ${m.name}`).toContain(m.name);
  }
});

test("the mapped types appear as each language spells them", () => {
  const starter = (l: string) => GENERATORS[l]?.(iface).starter ?? "";
  expect(starter("python")).toContain(
    "def stock(self, item: str) -> int | None:",
  );
  expect(starter("typescript")).toContain(
    "flags(values: (boolean | null)[]): boolean[]",
  );
  expect(starter("java")).toContain(
    "public Map<String, List<String>> group(List<String> names, String label)",
  );
  expect(starter("java")).toContain(
    "public long add(String item, long amount)",
  );
  expect(starter("cpp")).toContain(
    "std::optional<int64_t> stock(std::string item)",
  );
  expect(starter("go")).toContain(
    "func (s *Inventory) group(names []string, label *string) map[string][]string {",
  );
});

test("a run's files are the submission and the harness", () => {
  expect(Object.keys(runFiles("java", iface, "class X {}")).sort()).toEqual([
    "Inventory.java",
    "Main.java",
  ]);
  expect(Object.keys(runFiles("go", iface, "package main")).sort()).toEqual([
    "main.go",
    "solution.go",
  ]);
  expect(() => runFiles("cobol", iface, "")).toThrow(/cobol/);
});
