# 0041. Velox is the execution service; Interval sends it judge jobs

- Status: PROPOSED
- Date: 2026-11-12
- Supersedes: 0039 (PROPOSED), once accepted
- Superseded by: none

## Context

ADR-0039 (PROPOSED) built the execution engine as `services/exec` in this repo, "built to Velox's design", and answered Q-P5-01 with "no Velox code copied, and no edits to the Velox repository". On 2026-11-12 the owner decided otherwise:

> "interval wont handle the code running and evaluations as velox will do it (we may do changes if needed), velox runs as independent service and interval uses it"

The decisions already point this way:

- EXEC-1: "Run it against a hardened Velox and against Judge0; whichever passes wins."
- EXEC-2 is titled "Velox integration".

Velox (`RISHIK92/velox`, Go) today:

- runs every submission as a child process inside one long-lived worker container, as one user;
- shares its files between runs, and has network access to its own Redis and Postgres;
- measures memory only after a run, and has no pids limit.

That fails EXEC-3 ("Every run is isolated: a fresh sandbox …") and the EXEC-1 red-team suite. Its checking compares stdout with an expected string, which can't judge an LLD scenario: unordered and approximate checks, error lines, and the trusted checker of EXEC-4.

The owner's answers (2026-11-12) settle four things:

1. **Contract:** Velox speaks Interval's `JudgeJob`/`JudgeResult` contract (`packages/judge`, P5-W30-S05).
2. **Isolation:** Velox gets `services/exec`'s sandbox (a fresh container per run, gVisor in production), gated by the red-team suite.
3. **`services/exec` is retired now.**
4. **Repo access:** Claude commits and pushes Velox's `main`.

## Options

### A. Velox is the execution service, and Interval is its client (the owner's decision)

- **Pros:**
  - One engine, in the repo whose name the decisions use (EXEC-1, EXEC-2).
  - Velox serves other clients too (its API keys, users and docs already exist).
  - Interval keeps only a judge port (submit, then the result) with a Velox HTTP adapter and an in-memory fake (ADR-0012), added in P5-W30-S08.
- **Cons:**
  - The sandbox, checker, red-team suite and judge workers move into another repo, outside Interval's CI, checks and deploys (ADR-0011, ADR-0013).
  - The contracts cross a repo boundary, and ADR-0040's generated Go types now land in Velox.
  - Q-P5-01 raised Velox's licence and other contributors; that stays the owner's to settle.
  - EXEC-5's hosts (ECS on EC2, isolated subnet) become Velox's deployment, not Interval's CDK.
- **Cost to reverse:** medium. The `JudgeJob` contract stays Interval's, so another engine (or `services/exec` from git history) can sit behind the same port.

### B. Keep `services/exec` (ADR-0039)

- **Pros:** one repo, one CI, already green.
- **Cons:** against the owner's decision, and a second engine beside Velox.
- **Cost to reverse:** low.

## Recommendation (not a decision)

**A**, as the owner decided, with three conditions taken from the decisions:

1. **No player code before isolation:** no player code runs on Velox until it passes the red-team suite with `services/exec`'s per-run sandbox (EXEC-1, EXEC-3).
2. **Checking stays out of the sandbox:** it happens in Velox's worker, outside the sandbox (EXEC-4).
3. **The contract stays Interval's.** `JudgeJob`, `JudgeResult` and the LLD scenario and result contracts are defined in zod here (ADR-0040). Their JSON Schema and generated Go types are copied into Velox by one Interval command, and Velox's CI checks that its copy matches the schemas.

## Consequences

- **In Interval:**
  - `services/exec` is removed: engine, checker, red-team suite, judge workers and Dockerfiles.
  - The exec hosts in the CDK stacks go (`infra/src/exec-hosts.ts`, with its subnets, endpoints and ASG), along with the CI `redteam` job and the exec runbook.
  - Until Velox runs `JudgeJob`s, problem verification (`pnpm --filter @interval/lld verify`) and its integration tests have no engine. The unit checks of problem files still run.
- **Interval's services:** they reach Velox over HTTP. A judge port's Velox adapter calls `POST /judge` with a `JudgeJob` and reads `GET /judge/{id}` for the `JudgeResult`, configured from env (`VELOX_URL`, `VELOX_API_KEY`; ADR-0011). The Valkey judge client of P5-W30-S05 goes with `services/exec`, its only consumer.
- **Interval's problem tooling** (`verify`, mutation scoring, the lld integration tests): it runs locally against Velox's command-line binary, with `run` and `check` as `services/exec` had them, named by `EXEC_BIN`.
- **In Velox:**
  - **The sandbox:** each run gets a fresh container (no network, read-only root, non-root, capabilities dropped, pids, memory and CPU limits, gVisor in production), with Go among the language strategies.
  - **Time limits** (owner, 2026-11-12): wall clock from the program's start (or from READY after compiling), as `services/exec` had them, for now. Once the Linux execution hosts exist (EXEC-5), they're judged on CPU time read from the container's cgroup (`cpu.stat`, sampled while it runs, and unforgeable), with a wall-clock cap for programs that sleep. That fixes the flakiness under host load seen in P5-W30-S04. Docker Desktop and OrbStack keep the wall clock.
  - **Checking:** the LLD checker runs in the worker.
  - **The red-team suite** becomes Velox's acceptance test, Judge0 adapter included, so EXEC-1's comparison ("against a hardened Velox and against Judge0") still runs.
  - **Queues:** priority queues, and leased, idempotent jobs.
- **Codegen:** ADR-0040's Go output moves to `pnpm contracts:velox` (it writes into a Velox checkout at `$VELOX_DIR`).

## Open questions

- **Licence and contributors:** Velox has other contributors and no licence file (Q-P5-01).
- **Where Velox is deployed** (EXEC-5), and how Interval reaches it in the VM mode (ADR-0011).
- **Authentication:** whether Interval authenticates with a Velox API key or on a private network only.
