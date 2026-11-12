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
    expect(
      written.expected.map((e) => `${e.layer} ${String(e.index)}`),
    ).toEqual(["visible 0", "hidden 0", "hidden 1"]);
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
    expect(failures.every((f) => f.startsWith("javascript reference"))).toBe(
      true,
    );
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
