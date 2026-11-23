import { GENERATORS } from "@interval/lld";
import type { LoadedProblem } from "../../../../server/ports";
import { examplesOf } from "./examples";

// What a battle's screen shows of its problem, a battle's or practice's (ADR-0048): the
// interface's calls, one line each, the statement, the visible examples, and each
// language's base starter. Never the extension: the game server sends it.
export function screenOf(problem: LoadedProblem): {
  signatures: string[];
  statement: string;
  examples: string[];
  starters: Record<string, string>;
} {
  const { interface: api } = problem;
  const call = (name: string, params: { name: string }[]) =>
    `${name}(${params.map((p) => p.name).join(", ")})`;
  return {
    signatures: [
      call(api.class, api.constructor.params),
      ...api.methods.map(
        (m) =>
          call(m.name, m.params) +
          (m.returns === "void" ? "" : ` → ${m.returns}`),
      ),
    ],
    statement: problem.statement,
    examples: examplesOf(problem),
    starters: Object.fromEntries(
      Object.entries(GENERATORS).map(([language, generate]) => [
        language,
        generate(api).starter,
      ]),
    ),
  };
}
