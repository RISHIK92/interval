# 0003. Monorepo timing and repository layout

- Status: ACCEPTED
- Date: 2026-10-25
- Supersedes: none
- Superseded by: none

## Decision (owner, 2026-10-25)

Option B: full monorepo from day 1, with pnpm workspaces and Turborepo. This moves ARCH-3's timing from Phase 4 to Phase 1, and this ADR overrides ARCH-3 on timing only.
- Package names: `@interval/web`, `@interval/infra`, `@interval/db`.
- The Python worker directory is `workers/jobs` (ADR-0008), outside the pnpm workspace; Turborepo tasks call `uv` for it.

## Context

- ARCH-3: "A monorepo from Phase 4 (pnpm workspaces with Turborepo)." Phase 4 Week 19: "the monorepo, shared packages, the Expo shell".
- ARCH-1: Phase 1 already has two deployables: "Next.js full-stack app and a Python worker".
- ARCH-4: "Infrastructure as code with AWS CDK in TypeScript from day one."
- ADR-0002 (proposed) puts migrations and generated types in a location both deployables read.

So Phase 1 has three code units (Next.js app, Python worker, CDK app), two of them TypeScript, plus shared DB artifacts, all in one git repository. The question is whether to adopt the monorepo structure now or restructure in Phase 4.

The bootstrap already created `apps/`, `workers/`, `packages/`, `infra/` as empty directories. They can be removed if option A is chosen.

## Options

### A. Keep as written: no workspace tooling until Phase 4

The Next.js app at a fixed path with its own package.json and lockfile; CDK with its own package.json and lockfile; the Python worker as a uv project.
- Pros: matches ARCH-3 literally. No workspace config in Phase 1.
- Cons: two TS lockfiles and two copies of lint, format and tsconfig setup. Shared DB types (ADR-0002) need a path import or copy. Phase 4 then moves every file, rewrites import paths and CI, and changes Docker build contexts in the same week as the Expo shell.
- Cost to migrate later: about 1–2 days in Week 19, plus risk of breaking deploy paths mid-phase.

### B. Full monorepo now: `apps/ packages/ workers/ infra/`, pnpm workspaces and Turborepo

- Pros: final shape from day 1. No Phase 4 migration.
- Cons: Turborepo's caching and task graph add little with two TS packages. One more tool to configure and debug. Contradicts ARCH-3's timing.
- Cost to reverse: low. Removing Turborepo means replacing `turbo run` with `pnpm -r run`.

### C. Layout and pnpm workspaces now, Turborepo in Phase 4

`apps/web` (Next.js), `infra/` (CDK), `packages/db` (migrations and generated TS types), `workers/ingest` (uv project, outside the pnpm workspace). One pnpm lockfile for TS. Scripts run with `pnpm -r` or `pnpm --filter`. Turborepo is added in Week 19 when Expo and the shared packages listed in ARCH-3 arrive.
- Pros: one TS lockfile and one lint/format/tsconfig base. Shared DB types are a workspace package. Phase 4 adds packages and Turborepo without moving files. Docker build contexts and CI paths are stable from Week 1.
- Cons: deviates from ARCH-3's timing for workspaces (not for Turborepo), so it needs this ADR accepted. pnpm workspaces have some Next.js build quirks (standalone output tracing across workspace packages).
- Cost to reverse: low. Collapsing to option A means moving two directories.

## Recommendation (not a decision)

Option C. ARCH-4 and ARCH-1 already put two TS units and a Python unit in Phase 1, and ADR-0002 option C needs a shared `packages/db`. Workspaces are the smallest tool that serves that. Turborepo stays in Phase 4 as ARCH-3 says, because it only pays off with Expo and the shared packages.

If ADR-0002 picks option A or B (one side owns the schema), the case for C weakens, and A becomes reasonable.

## Consequences

- docs/proposals/phase-1-skeleton.md uses the option C layout.
- CI runs `pnpm -r` for TS checks and `uv` for the worker.
- The Next.js Docker build uses `output: "standalone"` with workspace tracing configured.
- Phase 4 Week 19 adds Turborepo and new packages only.

## Open questions

- Package names: `@interval/web`, `@interval/infra`, `@interval/db`? Suggested default: yes.
