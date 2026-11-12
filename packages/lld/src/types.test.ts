import { expect, test } from "vitest";
import { fits, formatType, parseType } from "./types";

// P5-W29-S01 (LLDQ-1, Q-P5-06): the one type grammar every language's starter code and
// harness is generated from.
test("each form parses and prints back the same", () => {
  for (const s of [
    "int",
    "float",
    "bool",
    "string",
    "list<int>",
    "map<string,list<float>>",
    "optional<string>",
    "list<map<string,optional<bool>>>",
  ])
    expect(formatType(parseType(s))).toBe(s);
  expect(parseType("list<int>")).toEqual({ kind: "list", of: { kind: "int" } });
  // Spaces are allowed and dropped.
  expect(formatType(parseType("map< string , int >"))).toBe("map<string,int>");
});

test("anything else is refused, with what was wrong", () => {
  for (const bad of [
    "",
    "integer",
    "list<>",
    "list<int",
    "list<int>>",
    "map<int,string>",
    "map<string>",
    "optional<optional<int>>",
    "set<int>",
    "list<list<list<list<int>>>>",
    "li st<int>",
    "map<str ing,int>",
  ])
    expect(() => parseType(bad), bad).toThrow(/type/);
});

test("a value fits its type exactly", () => {
  const f = (t: string, v: unknown) => fits(parseType(t), v);
  expect(f("int", 2 ** 53 - 1)).toBe(true);
  expect(f("int", 2 ** 53)).toBe(false);
  expect(f("int", 1.5)).toBe(false);
  expect(f("float", 3)).toBe(true);
  expect(f("float", Number.NaN)).toBe(false);
  expect(f("bool", 0)).toBe(false);
  expect(f("optional<int>", null)).toBe(true);
  expect(f("optional<int>", "1")).toBe(false);
  expect(f("map<string,int>", { a: 1 })).toBe(true);
  expect(f("map<string,int>", [1])).toBe(false);
  expect(f("list<optional<string>>", ["a", null])).toBe(true);
});
