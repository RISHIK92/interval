import type { Interface } from "./interface";
import type { Scenario } from "./scenario";
import { parseType, type TypeAst } from "./types";

// P5-W30-S02 (LLDQ-3): random scenarios from an interface, for a differential property:
// every language's reference must agree with the Python one on scenarios nobody wrote.
// Seeded (mulberry32), so a failure can be replayed; values are small and strings are
// mostly the problem's own words, so keys collide and state is exercised, not just created.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Random = () => number;
const int = (r: Random, lo: number, hi: number) =>
  lo + Math.floor(r() * (hi - lo + 1));
const ALPHABET = "abcd";

// A constructor's ints are positive: a capacity or a size of -3 only gives a failed
// constructor and nothing else worth comparing. Strings are mostly the problem's own
// words (P5-W30-S04): "small" or a client's name reaches the code paths "abcd" never does.
function value(
  t: TypeAst,
  r: Random,
  words: readonly string[],
  positive = false,
): unknown {
  switch (t.kind) {
    case "int":
      return int(r, positive ? 1 : -3, 20);
    case "float":
      return Math.round(r() * 2000) / 100;
    case "bool":
      return r() < 0.5;
    case "string": {
      // No draw without words, so a problem without any keeps its old seeds' scenarios.
      if (words.length > 0 && r() < 0.7)
        return words[int(r, 0, words.length - 1)];
      return Array.from(
        { length: int(r, 1, 3) },
        () => ALPHABET[int(r, 0, ALPHABET.length - 1)],
      ).join("");
    }
    case "list":
      return Array.from({ length: int(r, 0, 4) }, () => value(t.of, r, words));
    case "map":
      return Object.fromEntries(
        Array.from({ length: int(r, 0, 3) }, () => [
          value({ kind: "string" }, r, words),
          value(t.of, r, words),
        ]),
      );
    case "optional":
      return r() < 0.2 ? null : value(t.of, r, words);
  }
}

export function randomScenario(
  iface: Interface,
  seed: number,
  options: { strings?: readonly string[] } = {},
): Scenario {
  const r = mulberry32(seed);
  const words = options.strings ?? [];
  const args = (ps: { type: string }[], positive = false) =>
    ps.map((p) => value(parseType(p.type), r, words, positive));
  return {
    calls: [
      {
        method: "new",
        args: args(
          iface.constructor.params,
          true,
        ) as Scenario["calls"][number]["args"],
      },
      ...Array.from({ length: 30 }, () => {
        const m = iface.methods[int(r, 0, iface.methods.length - 1)];
        if (m === undefined) throw new Error("an interface has methods");
        return {
          method: m.name,
          args: args(m.params) as Scenario["calls"][number]["args"],
        };
      }),
    ],
  };
}
