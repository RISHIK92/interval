# Interval

Personal engineering learning platform. Solo-built, AWS, TS + Python + Go.
Product: docs/product.md · Decisions: docs/decisions.md (cite IDs) · Glossary: docs/glossary.md
Current phase: docs/roadmap/phase-1.md · Slices: docs/roadmap/phase-1-slices.md
Session log: docs/progress.md. Read it first, every session.
Read only the doc sections relevant to the task. Never load whole docs "for context".

## Source of truth and precedence
1. docs/adr/ (ACCEPTED only) → 2. docs/decisions.md → 3. docs/product.md → 4. docs/wireframes/ (UI only).
- Known disagreements: docs/conflicts.md.
- If docs conflict or are silent on behavior you need: STOP and ask. Never invent product behavior.
- Never edit docs/decisions.md, docs/product.md, docs/_source/, or ACCEPTED ADRs. Propose changes as a new ADR (use /adr).

## Stack (ARCH-2, strict)
- TypeScript: web, API, shared packages, simulation engine. Python: ingestion, ML, AI jobs. Go: game server, execution engine (Phase 3+).
- Nothing implemented twice across languages.
- Schema: plain SQL migrations in packages/db with generated TS and Python types (ADR-0002). Never hand-write a type the codegen produces.
- Every model call (LLM or embedding) goes through the Python worker's ai/gateway.py (ADR-0008, ADR-0007). TypeScript never imports a model SDK.
- Deployables are added only in the phase that needs them (ARCH-1). No Redis before Phase 3 (CACHE-1).

## Domain invariants (never violate)
- A source's rights profile gates every processing step (ING-2). No full text stored, processed, or displayed beyond what the profile allows.
- Moments are deep links into the publisher's page, never copies (Part I §3.2).
- AI output is stored separately from source text, cites its source passages, and is always labeled in UI (AI-3, AI-1).
- Explicit user choices always override inferred interests (PER-1).
- Agent hook sends only started/finished events. Never prompts or code (§7).
- Deliberate scaffolding is required, not speculative: entitlements (OPS-3), cost budgets (OPS-4), event tracking (DB-5), idempotency keys (LOAD-5). Never remove or "simplify away" anything a decision ID requires.

## Code standards
- TypeScript: strict mode, no `any`, no non-null `!` without a comment saying why. Python: full type hints, ruff + pyright strict. Go: gofmt, vet, no panics in request paths.
- Validate at boundaries (zod / pydantic); trust types inside.
- Never swallow errors. Graceful degradation only where LOAD-5 says so, and it must be observable (log + metric).
- No new dependency without asking, with a one-line reason. Prefer stdlib and platform features.
- Comments explain why, never what. No TODOs without an issue reference, no commented-out code, no dead exports.
- No abstraction with one caller. No config for things that don't vary yet. No "utils" dumping grounds.
- Names come from docs/glossary.md. Don't invent synonyms (a moment is a moment, not a "chunk" or "snippet").
- Tests verify behavior, not implementation. Every bug fix starts with a failing test.

## How we work
1. Plan mode first. A plan lists: files to touch, decision IDs implemented, tests to write, risks, open questions. Wait for approval.
2. One slice per session (docs/roadmap/phase-N-slices.md). Use /slice. Stay in scope; list anything else you noticed instead of fixing it.
3. Write failing tests → implement → run the reviewer subagent → fix → summarize the diff file by file, flagging uncertainty.
4. When a slice is done and verified, commit it (author `Claude <noreply@anthropic.com>`, no co-author line) and push `main`. Never force-push, deploy, or migrate a non-local DB. I do those.
5. End every session with /session-end.

## Commands
Tooling from docs/proposals/phase-1-skeleton.md (ACCEPTED). Later slices add CDK commands.
- Setup once: `corepack enable` (pnpm pinned in package.json) · `brew install uv dbmate` · `cp .env.example .env`
- Install: `pnpm install` (TS) · `uv sync --all-packages` (Python workspace: workers/jobs, packages/db/python)
- Local services: `docker compose up -d --wait` (Postgres + pgvector, SeaweedFS for S3, ElasticMQ for SQS)
- Migrate + regenerate types: `pnpm db:migrate` · stale-types check: `pnpm db:check`
- Web dev server: `pnpm --filter @interval/web dev` · build: `pnpm turbo build`
- Web image: `docker build -f apps/web/Dockerfile -t interval-web .` · run: `docker run -p 127.0.0.1:3100:3000 -e DATABASE_URL='postgres://interval:interval@host.docker.internal:5432/interval?sslmode=disable' interval-web`
- Worker, ingest one feed: `scripts/with-env.sh uv run python -m interval_jobs ingest-one --name N --feed-url URL --rights-profile metadata_only` (temporary until P1-W2-S01; full-text ingest also segments)
- Worker, re-split one item into moments: `scripts/with-env.sh uv run python -m interval_jobs segment-item --content-item-id ID`
- All checks (needs local services up; mirrors CI): `pnpm turbo check`
- One kind: `pnpm turbo typecheck //#typecheck:py` (likewise `lint`/`//#lint:py`, `test`/`//#test:py`, `format:check`/`//#format-check:py`)
- Format (writes): `pnpm turbo format //#format:py`
