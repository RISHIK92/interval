# 0012. Ports and adapters: business logic never depends on a concrete service

- Status: ACCEPTED
- Date: 2026-10-25
- Supersedes: none
- Superseded by: none

## Decision (owner, 2026-10-25)

Business logic depends only on small interfaces (ports). Each backing service sits behind an adapter, and swapping a service means replacing or reconfiguring one adapter.

Ports cover:
- **External services:** object storage, queue, cache, outbound HTTP fetch, model APIs (the ADR-0008 gateway), email.
- **Data access:** repository interfaces such as `Sources`, `ContentItems`, `Moments` and `Feed`. Business logic never sees SQL, psycopg or Kysely; the repositories' SQL lives in Postgres adapters (Postgres stays the one database, ADR-0002).

Today's S04–S06 code (ingest, segmentation, feed, health) moves to this shape now, before S09, in its own refactor slice.

## Context

- ADR-0011: two deployment modes (full AWS, single VM) from the same code. Each service has a managed and a container form.
- The owner wants business logic to be adaptable and independent of the service in use, and easy to swap.
- CLAUDE.md says "No abstraction with one caller". A port qualifies because it has at least two implementations: the real adapter and an in-memory fake used by tests. Some, like S3 vs SeaweedFS, also differ by configuration.

## Options

### A. Endpoints from env only (ADR-0011 as written)
- Pros: no new code shape.
- Cons: business logic still imports psycopg, boto3 and httpx, so swapping a provider (e.g. a non-S3 store or another model API) means editing logic.
- Cost to reverse: none.

### B. Ports for external services only
- Pros: smaller change; SQL stays inline.
- Cons: logic stays coupled to Postgres and its driver; tests need a database for every logic test.
- Cost to reverse: low.

### C. Ports for external services and data access (chosen)
- Pros: logic is testable with fakes and no I/O. Each service is swappable in one place. Rights gates and other invariants live in logic that cannot bypass them.
- Cons: more files (interface, Postgres adapter, fake). Repository methods must stay intent-shaped (e.g. `replace_sections(item, sections)`), not generic CRUD, or they leak SQL concerns into logic.
- Cost to reverse: medium.

## Consequences

- **Python (`workers/jobs`):**
  - `interval_jobs/ports/` holds Protocols.
  - `interval_jobs/adapters/` holds `postgres/`, `http/`, `s3/`, `queue/` and `fakes/`.
  - Logic modules (ingest, segment, feed) take ports as parameters.
  - Composition happens in one place, at CLI or consumer start.
  - `rights.py` stays pure logic.
- **TypeScript (`apps/web`):** `src/server/ports/` holds interfaces, `src/server/adapters/` holds Kysely and other adapters, and route handlers and pages get dependencies from one composition module.
- **Tests:** logic tests use fakes. The Postgres adapters keep their DB tests, including the DB triggers that guard ING-2.
- **Database guards:** they stay in the database as a second line, whatever the adapter.
- **Slice:** P1-W1-S19, a ports-and-adapters refactor, runs before S09.

## Open questions

- none
