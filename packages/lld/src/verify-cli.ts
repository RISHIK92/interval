// `pnpm --filter @interval/lld verify <problem dir> [--check] [--random N] [--mutation]`
// (P5-W30-S01, S02): verifies a problem's directory (problems/lld/<slug>, from W30-S03)
// and writes its expected.json; --check only confirms it is current; --random N adds
// seeded random scenarios; --mutation scores the tests against the Python reference's
// mutants (90% gate). Needs python3, and the execution engine's binary in EXEC_BIN, with
// its `run` and `check` commands (Velox's, ADR-0041 PROPOSED).
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { MUTATION_GATE, mutationScore } from "./mutation";
import { verify } from "./verify";

const usage = "usage: verify <problem dir> [--check] [--random N] [--mutation]";
let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      check: { type: "boolean", default: false },
      random: { type: "string", default: "10" },
      mutation: { type: "boolean", default: false },
    },
  });
} catch {
  console.error(usage);
  process.exit(1);
}
const { values, positionals } = parsed;
const dir = positionals[0];
const random = Number(values.random);
if (
  dir === undefined ||
  positionals.length > 1 ||
  !Number.isInteger(random) ||
  random < 0
) {
  console.error(usage);
  process.exit(1);
}
const exec = process.env["EXEC_BIN"];
if (exec === undefined || exec === "") {
  console.error(
    "no execution engine: set EXEC_BIN to Velox's binary (ADR-0041, P5-W30-S07)",
  );
  process.exit(1);
}
const failures: string[] = [];
const problem = resolve(dir);
const verified = verify(problem, {
  exec,
  mode: values.check ? "check" : "write",
  random,
});
failures.push(...verified.failures);
// Scored against verify's own results, and only when the references agree: a mutant
// judged against wrong results would mean nothing.
if (values.mutation && failures.length > 0)
  failures.push("mutation not scored: verification failed first");
else if (values.mutation) {
  const score = mutationScore(problem, { exec, expected: verified.expected });
  const share = score.total === 0 ? 1 : score.killed / score.total;
  console.log(
    `mutation: ${String(score.killed)} of ${String(score.total)} caught (${(share * 100).toFixed(0)}%)`,
  );
  if (share < MUTATION_GATE) {
    failures.push(
      `mutation score below ${String(MUTATION_GATE * 100)}%; survivors:`,
    );
    for (const m of score.survivors)
      failures.push(`  line ${String(m.line)}: ${m.kind}`);
  }
}
for (const f of failures) console.error(f);
console.log(
  failures.length === 0
    ? `${dir}: verified`
    : `${dir}: ${String(failures.length)} failures`,
);
process.exit(failures.length === 0 ? 0 : 1);
