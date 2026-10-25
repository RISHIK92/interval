# 0008. The Python worker owns feed ranking and every model call

- Status: ACCEPTED (open question on queue contracts below)
- Date: 2026-10-25
- Supersedes: none
- Superseded by: none

## Decision (owner, 2026-10-25)

Option B below:
- Feed ranking, why-this-matters notes and every model call run in the Python worker.
- The worker directory is `workers/jobs`, not `workers/ingest`.
- First feed for a new guest: the web app waits up to about 3 seconds for the recompute, then serves a starter feed precomputed per (primary topic, level).
- Recompute runs hourly for active users and after any feedback action. The last stored feed is served on failure (Q-P1-17).

## Context

- ARCH-2: TypeScript owns "web, mobile, API"; Python owns "ingestion, ML, and AI jobs". "Nothing gets written twice."
- CACHE-1: "Precomputed feeds live in a Postgres table." Ranking is a job, not request work.
- REC-2: rule-based ranking now, a gradient-boosted model later. REC-4: Thompson sampling (in Phase 1 per Q-P1-13).
- OPS-4: per-user cost budgets need one ledger writer.
- docs/proposals/phase-1-skeleton.md section 9 compared two candidates.

## Options

### A. Ranking and notes in the TypeScript web app
- Pros: no queue hop for a fresh feed.
- Cons: two languages call models, so two budget writers and two AI-3 storage paths. The learned ranker (REC-2) would be rewritten in Python later.
- Cost to reverse: medium.

### B. Ranking, notes and all model calls in the Python worker
- Pros: one owner for AI cost and AI-3 storage. The ranker grows into ML in the same language.
- Cons: a new guest's first feed depends on a job, so a starter feed is needed.
- Cost to reverse: medium.

## Consequences

- The web app only reads `feed_visible` and enqueues `feed.recompute`.
- Slices P1-W4-S02 to S04, S06 and S09 are Python. P1-W1-S16 (cost budgets) lives in `ai/gateway.py`.

## Open questions

- Do SQS message contracts (JSON Schema in `packages/db/messages/`) join ADR-0002's codegen, so TS and Python share one definition? Suggested default: yes. Not yet answered.
