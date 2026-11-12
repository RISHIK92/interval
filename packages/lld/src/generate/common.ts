import type { Interface } from "../interface";
import { parseType, type TypeAst } from "../types";

// P5-W29-S02 (LLDQ-1, EXEC-2): what every language's generator shares. A harness reads
// one scenario on stdin, builds the class from call 0, dispatches each later call
// through a generated switch (no reflection), and prints one result line per call:
// {"call":i,"value":…} or {"call":i,"error":"…"}, the error printable ASCII and at most
// 200 characters (ResultLine). The submission's own prints go to stderr.

export type Generated = {
  // The submission file's name, and the starter code a player begins from.
  solutionFile: string;
  starter: string;
  // The harness: the engine's main file for the language.
  harnessFile: string;
  harness: string;
};

export type Method = {
  name: string;
  params: { name: string; type: TypeAst }[];
  returns: TypeAst | "void";
};

export function methodsOf(iface: Interface): {
  ctor: Method["params"];
  methods: Method[];
} {
  const params = (ps: { name: string; type: string }[]) =>
    ps.map((p) => ({ name: p.name, type: parseType(p.type) }));
  return {
    ctor: params(iface.constructor.params),
    methods: iface.methods.map((m) => ({
      name: m.name,
      params: params(m.params),
      returns: m.returns === "void" ? "void" : parseType(m.returns),
    })),
  };
}

export const indent = (text: string, by: string) =>
  text
    .split("\n")
    .map((l) => (l === "" ? l : by + l))
    .join("\n");
