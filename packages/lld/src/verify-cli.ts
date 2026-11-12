// `pnpm --filter @interval/lld verify <problem dir> [--check] [--random N] [--mutation]`
// (P5-W30-S01, S02): verifies a problem's directory (problems/lld/<slug>, from W30-S03)
// and writes its expected.json; --check only confirms it is current; --random N adds
// seeded random scenarios; --mutation scores the tests against the Python reference's
// mutants (90% gate). Needs Docker, Go and python3 (it builds services/exec).
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { MUTATION_GATE, mutationScore } from "./mutation";
import { verify } from "./verify";

const repo = join(import.meta.dirname, "../../..");
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
const build = mkdtempSync(join(tmpdir(), "lld-exec-"));
const failures: string[] = [];
try {
  const exec = join(build, "exec");
  execFileSync("go", ["build", "-o", exec, "."], {
    cwd: join(repo, "services/exec"),
    stdio: "inherit",
  });
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
} finally {
  rmSync(build, { recursive: true, force: true });
}
for (const f of failures) console.error(f);
console.log(
  failures.length === 0
    ? `${dir}: verified`
    : `${dir}: ${String(failures.length)} failures`,
);
process.exit(failures.length === 0 ? 0 : 1);
