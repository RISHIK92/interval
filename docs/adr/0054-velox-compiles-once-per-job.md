# 0054. Velox compiles once per judge job, with its own budget and verdict

- Status: ACCEPTED (owner, 2026-11-26)
- Date: 2026-11-26
- Supersedes: none
- Superseded by: none

## Context

ADR-0041 (ACCEPTED) says of Velox's time limits: "wall clock from the program's start (or from READY after compiling), as `services/exec` had them, for now." EXEC-2 (docs/decisions.md) lists among Velox's integration goals: "**Speed:** compile once and run all scenarios in one process."

What Velox did until now (read in `~/velox/backend` at 013c404):

- Every scenario of a judge job ran in a fresh container that compiled the code first (`engine/languages.go:141`, `judgejob/worker.go:202-203`), so a job with 30 scenarios compiled 30 times.
- Compiling had its own small budget (C++ 5 s, Java 6 s, Go 8 s; `languages.go:30-31, 93-99`) on one CPU (`worker.go:195-199`). An overrun was reported as `time_limit` (`run.go:298-356`), because `verdict()` checks the timeout before the compile failure.

The effect, found while verifying the LLD practice catalog (Q-WD-30) in CI: the generated LLD harness takes about 2.5 s of CPU to compile in C++, and code that builds a `std::regex` takes 6–8 s. The reference solutions that used `std::regex` failed with `time_limit` on every scenario, intermittently, depending on the runner's load. A player's C++ would fail the same way, and the verdict would point at the program's speed, not at the compile. The references were rewritten without `std::regex` (commits 6f2f371 and ee08b99), which fixes CI but not the player's case.

Asked how Velox should handle this (2026-11-26), the owner chose "compile once + clear verdict". That changes the timing ADR-0041 records ("from READY after compiling") and delivers part of EXEC-2's speed goal in a different shape (one compile, then one container per scenario, not one process), so it needs this ADR.

## Options

### A. Compile once per job in its own sandbox, run each scenario against the artifact (built, uncommitted)

- **How:**
  - The compiler runs once, in its own container with every isolation flag a run has (gVisor in production, no network, read-only root, non-root, capabilities dropped, pids/memory/CPU limits) and only the code mounted read-only.
  - The artifact leaves only as a tar on standard output. The host unpacks it safely: regular files and directories only, no links or traversal, at most 4096 entries, normalised modes.
  - Each scenario then runs in a fresh container with the artifact mounted read-only.
  - Compiling gets its own budget: C++ 15 s, Java 15 s, Go 20 s. An overrun is a new verdict, `compile_time_limit` ("your code took too long to compile"). A compile failure stays `compile_error`. Either way, every scenario gets that verdict without running.
  - The program's time limit runs from its own container's start, so compiling never counts against it.
- **Pros:**
  - Fixes the player's case.
  - Compiling happens once per job instead of once per scenario, so judging is faster.
  - The verdict says what happened.
  - Per-scenario isolation is unchanged.
- **Cons:**
  - A new verdict in the contract (`packages/judge`), so Interval must deploy before Velox: an old game server refuses the unknown verdict.
  - Existing per-problem limits get slightly looser, since programs no longer pay for compiling.
  - The tar round trip and the new budgets are untested against the real images on m6, where they aren't pulled. Velox's CI runs them (`EXEC_INTEGRATION`).
- **Cost to reverse:** moderate. Revert the Velox commit; the extra verdict can stay in the contract unused.

### B. Raise the compile budget only

- **Pros:** a one-line change; no contract change.
- **Cons:**
  - Still compiles once per scenario, so judging gets slower as budgets grow.
  - An overrun is still reported as `time_limit`.
- **Cost to reverse:** trivial.

### C. Compile once and run every scenario in one process (EXEC-2's literal wording)

- **Pros:** fastest; matches EXEC-2 word for word.
- **Cons:**
  - Scenarios would share a process, so one scenario's state, crash or memory could affect the next. That weakens EXEC-3 ("every run is isolated").
  - The harness contract changes too.
- **Cost to reverse:** high.

## Recommendation (not a decision)

Option A. It is what the owner chose on 2026-11-26. It keeps EXEC-3's per-run isolation, which option C gives up, and it fixes the misleading verdict, which option B doesn't.

## Consequences

- **The timing:** ADR-0041's "from READY after compiling" becomes "from the program's own container start; compiling has its own budget and verdict."
- **EXEC-2:** its speed goal is met as "compile once per job", not "one process".
- **The contract:** `JudgeResult` gains the verdict `compile_time_limit` (`packages/judge/src/job.ts`), regenerated into Velox with `pnpm contracts:velox`. The game server, the game client and the battle screen show it as "your code took too long to compile". LLD verify fails a reference that gets it.
- **Deploy order:** Interval first, then Velox.
- **CI:** Interval's `lld-verify.yml` pins Velox at 013c404. After the Velox commit lands, the pin moves to it, so the catalog is verified under the new flow.
- **Follow-up:** re-time the per-problem limits against the references once EXEC-5's CPU-time limits exist.

## Open questions

- Should Python, JavaScript and TypeScript get the same split (import or type-strip once), or stay one container per run? They have no compile step today.
