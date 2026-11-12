// `pnpm --filter @interval/lld verify <problem dir> [--check]` (P5-W30-S01): verifies a
// problem's directory (problems/lld/<slug>, from W30-S03) and writes its expected.json;
// --check only confirms it is current. Needs Docker and Go (it builds services/exec).
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { verify } from "./verify";

const repo = join(import.meta.dirname, "../../..");
const [dir, flag] = process.argv.slice(2);
if (dir === undefined || (flag !== undefined && flag !== "--check")) {
  console.error("usage: verify <problem dir> [--check]");
  process.exit(1);
}
const build = mkdtempSync(join(tmpdir(), "lld-exec-"));
let failures: string[];
try {
  const exec = join(build, "exec");
  execFileSync("go", ["build", "-o", exec, "."], {
    cwd: join(repo, "services/exec"),
    stdio: "inherit",
  });
  ({ failures } = verify(resolve(dir), {
    exec,
    mode: flag === "--check" ? "check" : "write",
  }));
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
