# Interval

Interval is a personal engineering learning platform that turns the small gaps in a developer's day into real learning. It finds existing high-quality technical content, connects it to the user's interests, projects, and current knowledge, and helps them make steady progress across many short sessions. (docs/product.md §1)

"Interval" is a working name.

## Status

Bootstrap. No application code yet.

## Docs

| Path | Contents |
|---|---|
| docs/product.md | Product definition (Part I of the blueprint, verbatim) |
| docs/decisions.md | Decision log with IDs (Part II, verbatim) |
| docs/open-decisions.md | Open decisions (Part IV) |
| docs/roadmap/ | Phase plans; phase-1-slices.md breaks Phase 1 into sessions |
| docs/adr/ | Architecture decision records. ACCEPTED ones override decisions.md |
| docs/conflicts.md | Disagreements between source documents |
| docs/glossary.md | Domain terms. Code uses these names |
| docs/questions/ | Open questions per phase |
| docs/proposals/ | Proposals awaiting a decision |
| docs/wireframes/ | Oct 22 wireframes. UI reference only |
| docs/_source/ | Untouched copies of the source documents |
| docs/progress.md | Session log |

## Working on the repo

Claude Code writes the code, one slice per session, under the rules in CLAUDE.md. The owner makes every architecture and product decision, and does all commits, pushes and deploys.

The `apps/`, `workers/`, `packages/` and `infra/` directories stay empty until the owner decides docs/proposals/phase-1-skeleton.md and ADR-0003.

Demo data for screenshots and design comparison (local services only: it refuses a `DATABASE_URL` or `VALKEY_URL` whose host isn't localhost, 127.0.0.1 or ::1, but it can't tell a remote database tunnelled to localhost): `pnpm --filter @interval/web demo:seed` fills sample sources, articles, moments, two paths, a feed, saves, notes, due reviews, a daily streak, boards and ratings for the test users `walk-a` and `walk-b` (it needs them, and `walk-c`/`walk-d`, to exist). Each user's feed follows their stored onboarding choices, and the demo daily it approves for the last five days is global, so every local account sees it. It calls no model, stores no full text, marks its rows (`Demo · …` sources, `demo-…` slugs and guids) and is safe to rerun.
