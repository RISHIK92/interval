# 0039. The execution engine is a Go service in this repo, built to Velox's design

- Status: PROPOSED
- Date: 2026-11-12
- Supersedes: none
- Superseded by: 0041 (PROPOSED), once accepted

## Context

Phase 5 adds the code execution engine (ARCH-1). Go is its language (ARCH-2: "Go: game servers and the execution engine"). EXEC-1 reads: "Run it against a hardened Velox and against Judge0; whichever passes wins." EXEC-2 is titled "Velox integration". It asks for generated harnesses, Go support, priority queues, compile-once runs and per-language limits.

Velox is the owner's separate repository (`RISHIK92/velox`), a Go engine with these parts:

- an API server, with API keys, users and Postgres;
- a Redis-polling worker;
- a strategy per language;
- a batch runner.

It has outside contributors (merged pull requests) and no licence file. Interval's checks, CI, CDK stacks and deploy scripts cover only this monorepo (ADR-0011, ADR-0013). Q-P5-01 asks where the engine lives.

## Options

### A. A new Go service, `services/exec`, in this repo, written to Velox's design

- Pros:
  - One repo, one CI and one deploy.
  - It uses the monorepo's Valkey queues (ADR-0014) and env-driven backing services (ADR-0011).
  - EXEC-3's isolation is built in from the start, rather than retrofitted.
  - No question of licence or authorship over copied code.
- Cons:
  - Velox's existing code isn't reused directly.
  - The "Velox" in EXEC-1 becomes Velox's design rather than its code.
- Cost to reverse: medium. The service sits behind a queue contract, so another engine could replace it behind the same contract.

### B. Vendor Velox into the monorepo

- Pros: reuses working code.
- Cons:
  - No licence file, and other contributors' code. Using it needs their permission or a licence.
  - It brings its own auth, users and Postgres, which Interval doesn't need.
- Cost to reverse: medium.

### C. Run Velox as an external service from its own repo

- Pros: no code moves.
- Cons:
  - Two repos and two deploys, against ADR-0013 ("Build and verify everything locally").
  - EXEC-2's changes would land in another repo, outside Interval's checks.
- Cost to reverse: low.

## Recommendation (not a decision)

Option A, which follows ARCH-1, ARCH-2 and ADR-0013 most directly. Judge0 stays the comparison engine for EXEC-1's red-team suite, run from its published image by the owner (it needs a privileged Linux Docker host). If Velox gains a licence and the owner wants its code, Option B becomes viable for the runner only.

## Consequences

- `services/exec` is a new Go module. Its isolation is Q-P5-02's per-run container, with gVisor on the execution hosts (EXEC-5).
- The red-team suite (Q-P5-03) targets engines through an adapter: `services/exec` in CI and locally, Judge0 when the owner runs it.
- Open: whether the owner wants the Velox repository's history or name carried over (no for now).
