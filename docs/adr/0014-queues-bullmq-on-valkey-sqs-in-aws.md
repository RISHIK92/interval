# 0014. Queues: BullMQ on Valkey for local and VM, SQS in full AWS; retire ElasticMQ

- Status: ACCEPTED
- Date: 2026-10-25
- Supersedes: none (amends LOAD-3 as applied by ADR-0011)
- Superseded by: none

## Decision (owner, 2026-10-25)

Option A, as recommended:
- BullMQ on Valkey for local development and the VM;
- SQS in the full-AWS mode, behind one queue port (ADR-0012);
- ElasticMQ retired.

Answers to the open questions:
- **VM persistence:** Valkey with AOF every second (`--appendonly yes --appendfsync everysec`), data on the VM's retained data volume.
- **Worker shape:** the BullMQ consumer adapter runs an asyncio loop, and the existing synchronous stages run through `asyncio.to_thread`. The SQS adapter stays synchronous.
- **Real-time state in Phase 1:** none beyond BullMQ's own data. Presence, leaderboards and game events arrive with their Phase 3 features (CACHE-2, CACHE-3).

## Context

The owner (2026-10-25) wants:

- "Valkey for real-time state and BullMQ queues."
- "BullMQ TypeScript for enqueueing jobs from the API."
- "BullMQ Python for consuming jobs, after validating its maturity and required features."
- "use sqs only for aws deployment retire elasticmq". Clarified by the owner: BullMQ on Valkey for local development and the VM, SQS in the full-AWS mode, behind one queue port.

That changes what the docs say today:

- **LOAD-3:** "Background work uses SQS; real-time work uses Redis." Under this ADR, SQS remains only in the full-AWS mode.
- **ADR-0011 (ACCEPTED):**
  - "Single VM. One EC2 VM runs everything from one compose file: Postgres+pgvector, Redis, the web app, the worker, a queue (ElasticMQ), …"
  - "Each one has a protocol-compatible container: Postgres, Redis, ElasticMQ for SQS, SeaweedFS for S3."
  - Its consequences name `SQS_ENDPOINT` and say "Features must be limited to what both the managed service and its container support (for example, SQS features ElasticMQ lacks)."
- **CACHE-1/CACHE-2:** ADR-0011 already brought Redis into Phase 1. This ADR names the engine Valkey in every mode. The AWS stack already runs ElastiCache Valkey 8.0; the VM compose runs `redis:8.8.3-alpine`; local dev runs no Redis yet.
- **ADR-0012:** "Business logic depends only on ports (interfaces) … Logic never imports a driver or SDK." A queue is a port, so the two engines are two adapters.
- **ARCH-2:** "Nothing implemented twice across languages." Producers are TypeScript (the API) and consumers are Python (the worker, ADR-0008). Each side needs both adapters: TS enqueue for BullMQ and SQS, Python consume for BullMQ and SQS. These are adapters per engine, not the same logic written twice. The job payload contract must exist once.
- **P1-W2-S02** ("Staged pipeline on SQS", LOAD-3, LOAD-5): "ingestion runs as stages chained by SQS messages, each stage retryable and idempotent, with failures landing in a DLQ … a stage that fails three times goes to the DLQ; re-delivering a message does not duplicate rows". This is the first real producer and consumer, and it would be renamed to queue-neutral wording.
- No item in docs/open-decisions.md covers queues, and no conflict (C-NN) touches them.

### BullMQ Python maturity check (2026-10-25)

Sources: PyPI `bullmq`, and the BullMQ repository's `python/README.md` and `docs/gitbook/python/introduction.md`.

- **Activity:**
  - 146 releases since 0.1.0 (2023-02-15);
  - latest 3.4.3 (2026-10-20), with releases weekly in October 2026;
  - same maintainers as BullMQ for Node (npm 6.4.2, 2026-10-24).
- **Requirements:** Python >= 3.10 (we run 3.13). Dependencies: `redis` (redis-py) < 9, `msgpack`, `semver`, `croniter`. All four are pinned exactly by the package, so they will constrain our lockfile.
- **Ported features, per its README:** regular, delayed, deduplicated, prioritised and repeatable (JobScheduler) jobs; workers; job events (QueueEvents); progress; retries; backoff; getters; Flow Producer; batched lock renewal; global concurrency and rate limit; cooperative per-job cancellation.
- **What W2-S02 needs:**
  - retry with backoff and a terminal failure after N attempts: yes (attempts plus the failed set, which acts as the DLQ);
  - idempotent re-delivery: yes (custom job ids and deduplication, alongside our own idempotency keys, LOAD-5);
  - delayed jobs for adaptive polling (W2-S03): yes;
  - concurrency limits for the polite fetcher (W2-S04): yes (global concurrency and rate limit).
  - Gap: none found for Phase 1.
- **Risks:**
  - The Python introduction still says "BullMQ is now also available as an experimental python package", and the README says it "does not support all the features available in the NodeJS version".
  - It is asyncio-only. Our worker is synchronous today (psycopg sync, httpx sync), so the BullMQ consumer adapter needs an asyncio entry point that runs each stage in a thread (`asyncio.to_thread`), or the worker moves to async I/O.
  - The pinned transitive versions may conflict with future dependencies.
- **Verdict:** the features are sufficient for Phase 1. Maturity is acceptable with a pin and a contract test suite that runs the same consumer cases against BullMQ and an in-memory fake (as the store contract does). Re-check before Phase 3's execution queue, which needs priorities (LOAD-3).

## Options

### A. BullMQ on Valkey for local and VM; SQS in full AWS, behind one queue port (owner's stated choice)

- **Pros:**
  - The VM drops one container (ElasticMQ) and uses the Valkey it already needs for real-time state.
  - BullMQ gives retries, backoff, delays, deduplication, rate limits and flows that ElasticMQ only approximates.
  - AWS keeps SQS (LOAD-3), with no queue state in ElastiCache to back up or size.
  - Local dev matches the VM.
- **Cons:**
  - Two engines with different semantics behind one port: BullMQ has priorities, delays beyond 15 minutes and job ids; SQS has none of these. The port is limited to what both support (as ADR-0011 already required for ElasticMQ), and anything beyond that needs an ADR.
  - Four adapters: TS enqueue and Python consume, for each engine.
  - The SQS path is exercised only by adapter tests and the AWS deploy, never by local runs, so a contract suite has to stand in for local use.
- **Cost to reverse:** low to medium. Callers depend on the port, so moving to either engine everywhere means deleting adapters.

### B. BullMQ on Valkey everywhere; drop SQS

- **Pros:** one engine, two adapters, and the same semantics in every mode, so local runs exercise the production path. Priorities are available for the Phase 3 execution queue.
- **Cons:**
  - Contradicts LOAD-3 and the owner's "use sqs only for aws deployment".
  - Queue durability in AWS rides on ElastiCache (persistence and failover config, memory sizing) instead of a serverless queue.
  - DLQs and redrive become BullMQ's failed set plus our own tooling.
- **Cost to reverse:** medium (re-add SQS adapters and infra).

### C. Keep SQS with ElasticMQ for local and VM (status quo, ADR-0011)

- **Pros:** one engine and one wire protocol in every mode; no new dependency; matches LOAD-3 literally.
- **Cons:** goes against the owner's direction; ElasticMQ lacks some SQS features; no rate limiting or flows without our own code; one more container on the VM.
- **Cost to reverse:** low.

## Recommendation (not a decision)

Option A. It is what the owner asked for, after clarification. It keeps LOAD-3 in the managed mode, where SQS's durability matters most. ADR-0012's ports and adapters already absorb a different engine per mode, in the way ADR-0011 absorbed ElasticMQ.

The maturity check found every Phase 1 feature W2-S02 to W2-S04 need. Two conditions apply: pin `bullmq` exactly, and gate it with a shared consumer contract suite.

What would change this:

- if the contract suite can't make the two engines behave alike on retries, the DLQ and redelivery, or Phase 3 needs priorities in AWS, Option B is better;
- if BullMQ Python stays "experimental" with breaking releases, Option C is the fallback for the VM.

## Consequences

- **Queue port (ADR-0012):**
  - TS: an `enqueue(queue, job, { idempotencyKey })` port with BullMQ and SQS adapters.
  - Python: a consumer port with BullMQ (asyncio entry, sync stages via `asyncio.to_thread`) and SQS (long-poll) adapters.
  - Semantics are limited to the intersection: at-least-once delivery, retries with a fixed attempt count, a terminal failed store (BullMQ's failed set, or the SQS DLQ), delays of at most 15 minutes, and no priorities.
  - One contract suite runs against an in-memory fake, BullMQ on a local Valkey, and (adapter-level) SQS with a stubbed client.
- **Job payloads:** one schema list with generated TS and Python types, like `packages/events` (ARCH-2).
- **Infra and env:**
  - **Local dev:** `docker-compose.yml` adds Valkey (pinned `valkey/valkey` 8.x) and removes ElasticMQ.
  - **VM:** `deploy/compose.prod.yml` swaps `redis:8.8.3-alpine` for Valkey and drops ElasticMQ; `write-env.sh` drops `SQS_ENDPOINT` and sets `QUEUE_TRANSPORT=bullmq` with `VALKEY_URL`.
  - **AWS stack:** keeps SQS and DLQs and sets `QUEUE_TRANSPORT=sqs`. The ElastiCache Valkey there stays for real-time state only.
  - The env contract (ADR-0011 consequences) changes from `SQS_ENDPOINT` to `QUEUE_TRANSPORT` plus either `VALKEY_URL` (BullMQ) or the queue URLs (SQS); `REDIS_URL` is renamed `VALKEY_URL`.
- **New dependencies** (to be approved at build time): `bullmq` (npm) for apps/web, and `bullmq` (PyPI) for workers/jobs, both pinned; plus the AWS SQS SDK adapters (`@aws-sdk/client-sqs`, and boto3 already present).
- **Slices:** P1-W2-S02 becomes "Staged pipeline on the queue port" and builds the port, adapters, infra and env above. The ElasticMQ removal and the Valkey container land there too. No earlier slice changes.
- **Docs:**
  - CLAUDE.md's Stack line and local-services command (ElasticMQ) change when W2-S02 lands;
  - ADR-0011 stays ACCEPTED, with its queue sentence amended by this ADR;
  - docs/decisions.md is not edited.

## Open questions

None; answered in the Decision section (owner, 2026-10-25).
