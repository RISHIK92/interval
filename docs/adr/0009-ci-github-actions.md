# 0009. CI on GitHub Actions

- Status: ACCEPTED
- Date: 2026-10-25
- Supersedes: none
- Superseded by: none

## Decision (owner, 2026-10-25)

GitHub Actions runs the PR checks in docs/proposals/phase-1-skeleton.md section 5. No deploy jobs; the owner deploys.

## Context

Phase 1 Week 1 lists "CI/CD". No decision ID names a CI tool. ARCH-4 needs `cdk synth` in CI; ADR-0002 needs a migration and codegen check against Postgres with pgvector.

## Options

### A. GitHub Actions
- Pros: no extra infrastructure if the repo lives on GitHub. Service containers give Postgres + pgvector.
- Cons: ties CI to GitHub.
- Cost to reverse: low; the jobs call `pnpm check` and `uv` commands that run anywhere.

### B. AWS CodeBuild / CodePipeline
- Pros: AWS-native.
- Cons: more setup; AWS not used until beta (ADR-0005).
- Cost to reverse: low.

### C. Local checks only
- Pros: nothing to set up.
- Cons: no enforcement on PRs.
- Cost to reverse: none.

## Consequences

- `.github/workflows/ci.yml` is created in P1-W1-S07.
- The repo needs a GitHub remote before S07 runs. The owner creates it.

## Open questions

- none
