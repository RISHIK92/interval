# Architecture decision records

An ADR records one decision that the blueprint does not settle, or changes one it does. Claude drafts ADRs (use /adr). The owner accepts or rejects them.

## Statuses

| Status     | Meaning                                                        |
| ---------- | -------------------------------------------------------------- |
| PROPOSED   | Drafted, not decided. Not binding. Code must not depend on it. |
| ACCEPTED   | Decided by the owner. Binding.                                 |
| REJECTED   | Decided against. Kept for the record.                          |
| SUPERSEDED | Replaced by a later ADR, named in its header.                  |

## Rules

- An ACCEPTED ADR overrides docs/decisions.md and docs/product.md where they disagree. Precedence is set out in ADR-0001 and CLAUDE.md.
- ACCEPTED ADRs are never edited. A change is a new ADR that supersedes the old one.
- docs/decisions.md and docs/product.md are never edited to match an ADR. They stay verbatim copies of the blueprint.
- Only the owner changes a status.

## Index

| #                                                        | Title                                                                        | Status                                       | Blocks                                                |
| -------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------- |
| [0001](0001-record-decisions-as-adrs.md)                 | Record decisions as ADRs; source precedence                                  | ACCEPTED                                     | process only                                          |
| [0002](0002-schema-ownership-ts-python.md)               | Schema ownership between TypeScript and Python                               | ACCEPTED                                     | all DB slices                                         |
| [0003](0003-monorepo-timing.md)                          | Monorepo from day 1 (pnpm + Turborepo)                                       | ACCEPTED                                     | first code slice                                      |
| [0004](0004-auth-provider.md)                            | Auth with Better Auth; guest sessions                                        | ACCEPTED; guest-first parts amended by 0016  | auth and guest slices                                 |
| [0005](0005-web-hosting.md)                              | Web and API hosting (local until beta)                                       | SUPERSEDED by 0011                           | none                                                  |
| [0006](0006-conflict-resolutions.md)                     | Resolutions for source conflicts in Phases 1–3                               | ACCEPTED; C-06 amended by 0017, C-07 by 0018 | onboarding, feed, reading slices                      |
| [0007](0007-model-providers.md)                          | OpenRouter for LLMs, Voyage AI for embeddings                                | ACCEPTED                                     | tagging, notes, embeddings                            |
| [0008](0008-python-worker-owns-ranking-and-ai.md)        | Python worker owns ranking and model calls                                   | ACCEPTED (open question answered in 0010)    | ranking, notes, budgets                               |
| [0009](0009-ci-github-actions.md)                        | CI on GitHub Actions                                                         | ACCEPTED                                     | P1-W1-S07                                             |
| [0010](0010-answers-to-open-questions-0004-0007-0008.md) | Answers to open questions in 0004, 0007, 0008                                | ACCEPTED                                     | P1-W2-S02, P1-W3-S02, Phase 2 auth                    |
| [0011](0011-two-deployment-modes.md)                     | Two deployment modes: full AWS and single VM                                 | ACCEPTED                                     | P1-W1-S09, P1-W1-S18                                  |
| [0012](0012-ports-and-adapters.md)                       | Ports and adapters: business logic never depends on a concrete service       | ACCEPTED                                     | P1-W1-S19, all later slices                           |
| [0013](0013-build-locally-deploy-at-the-end.md)          | Build every phase locally; deploy once everything is built                   | ACCEPTED                                     | all deploys                                           |
| [0014](0014-queues-bullmq-on-valkey-sqs-in-aws.md)       | Queues: BullMQ on Valkey for local and VM, SQS in full AWS; retire ElasticMQ | ACCEPTED                                     | P1-W2-S02                                             |
| [0015](0015-learning-goals.md)                           | Learning goals in onboarding, ranking and Profile                            | ACCEPTED                                     | design pass: onboarding, Profile, ranking             |
| [0016](0016-account-first-onboarding.md)                 | Account-first onboarding                                                     | ACCEPTED                                     | design pass: join, sign-up, onboarding; W1-S12        |
| [0017](0017-five-tab-bar-with-later-tabs-disabled.md)    | Five-tab bar with the later tabs shown disabled                              | ACCEPTED                                     | design pass: tab bar (amends ADR-0006 C-06)           |
| [0018](0018-in-app-reader-framed-publisher-page.md)      | In-app reader: the publisher's live page, framed, in the PWA and web         | ACCEPTED                                     | home experience before Phase 2 (amends ADR-0006 C-07) |
| [0019](0019-web-home-layout.md)                         | Web Home layout: sidebar with Leagues, sideways feed, "Coming later" column, greeting | ACCEPTED | design pass: Home (amends ADR-0017) |
| [0020](0020-groq-as-a-second-llm-provider.md) | Groq as a second LLM provider, chosen per model | ACCEPTED | tagging model pick (amends ADR-0007) |
| [0021](0021-google-gemini-api-as-an-llm-provider.md) | Google's Gemini API as an LLM provider, chosen per model like Groq | ACCEPTED | tagging model pick (extends ADR-0020) |
| [0022](0022-tesseract-ocr-service.md) | OCR for scanned book pages: a Tesseract container, not Textract | ACCEPTED | Week 11 PDF books (amends ING-5) |
| [0023](0023-ocr-as-a-worker-sidecar-in-aws.md) | OCR in AWS mode: a sidecar in the worker's task | ACCEPTED | P2-W11-S03 (amends ADR-0022) |
| [0024](0024-github-app-for-repository-access.md) | GitHub repository access through a GitHub App; GitHub sign-in deferred | ACCEPTED | Week 12 planning (amends ADR-0010 item 2) |
| [0025](0025-card-explanations-from-a-template-library.md) | Card explanations from a deterministic template library, not model polishing | ACCEPTED | owner direction 2026-10-29 (amends REC-5, Q-P1-18) |
| [0026](0026-shown-for-reasons-on-every-card.md) | "Shown for" reasons on every card, rendered from the ranking itself | ACCEPTED | owner direction 2026-10-29 (amends ADR-0025) |
| [0027](0027-one-plain-explanation-per-card.md) | One plain, stable explanation per card; tag-derived values shown without an AI label | ACCEPTED | owner review 2026-10-29 (amends ADR-0026, AI-3) |
