# Architecture decision records

An ADR records one decision that the blueprint does not settle, or changes one it does. Claude drafts ADRs (use /adr). The owner accepts or rejects them.

## Statuses

| Status | Meaning |
|---|---|
| PROPOSED | Drafted, not decided. Not binding. Code must not depend on it. |
| ACCEPTED | Decided by the owner. Binding. |
| REJECTED | Decided against. Kept for the record. |
| SUPERSEDED | Replaced by a later ADR, named in its header. |

## Rules

- An ACCEPTED ADR overrides docs/decisions.md and docs/product.md where they disagree. Precedence is set out in ADR-0001 and CLAUDE.md.
- ACCEPTED ADRs are never edited. A change is a new ADR that supersedes the old one.
- docs/decisions.md and docs/product.md are never edited to match an ADR. They stay verbatim copies of the blueprint.
- Only the owner changes a status.

## Index

| # | Title | Status | Blocks |
|---|---|---|---|
| [0001](0001-record-decisions-as-adrs.md) | Record decisions as ADRs; source precedence | ACCEPTED | process only |
| [0002](0002-schema-ownership-ts-python.md) | Schema ownership between TypeScript and Python | ACCEPTED | all DB slices |
| [0003](0003-monorepo-timing.md) | Monorepo from day 1 (pnpm + Turborepo) | ACCEPTED | first code slice |
| [0004](0004-auth-provider.md) | Auth with Better Auth; guest sessions | ACCEPTED | auth and guest slices |
| [0005](0005-web-hosting.md) | Web and API hosting (local until beta) | SUPERSEDED by 0011 | none |
| [0006](0006-conflict-resolutions.md) | Resolutions for source conflicts in Phases 1–3 | ACCEPTED | onboarding, feed, reading slices |
| [0007](0007-model-providers.md) | OpenRouter for LLMs, Voyage AI for embeddings | ACCEPTED | tagging, notes, embeddings |
| [0008](0008-python-worker-owns-ranking-and-ai.md) | Python worker owns ranking and model calls | ACCEPTED (open question answered in 0010) | ranking, notes, budgets |
| [0009](0009-ci-github-actions.md) | CI on GitHub Actions | ACCEPTED | P1-W1-S07 |
| [0010](0010-answers-to-open-questions-0004-0007-0008.md) | Answers to open questions in 0004, 0007, 0008 | ACCEPTED | P1-W2-S02, P1-W3-S02, Phase 2 auth |
| [0011](0011-two-deployment-modes.md) | Two deployment modes: full AWS and single VM | ACCEPTED | P1-W1-S09, P1-W1-S18 |
| [0012](0012-ports-and-adapters.md) | Ports and adapters: business logic never depends on a concrete service | ACCEPTED | P1-W1-S19, all later slices |
| [0013](0013-build-locally-deploy-at-the-end.md) | Build every phase locally; deploy once everything is built | ACCEPTED | all deploys |
| [0014](0014-queues-bullmq-on-valkey-sqs-in-aws.md) | Queues: BullMQ on Valkey for local and VM, SQS in full AWS; retire ElasticMQ | ACCEPTED | P1-W2-S02 |
