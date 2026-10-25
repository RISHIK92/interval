# 0002. Schema ownership between TypeScript and Python

- Status: ACCEPTED
- Date: 2026-10-25
- Supersedes: none
- Superseded by: none

## Decision (owner, 2026-10-25)

Option C: tool-neutral plain SQL migrations in `packages/db`, with TS and Python types generated from the migrated schema and checked in CI.
- Migrations stay backward compatible for one release, so the web app and worker can deploy in either order.
- In AWS, a one-off ECS task applies migrations before new services roll out. The owner triggers it.
- Still open: whether SQS message contracts join the same codegen (see ADR-0008).

## Context

From Phase 1, two deployables in two languages share one Postgres database:
- ARCH-1: Phase 1 deployables are "Next.js full-stack app and a Python worker".
- ARCH-2: TypeScript owns web and API; Python owns "ingestion, ML, and AI jobs". "Nothing gets written twice."
- DB-1: Postgres on RDS holds "users, content, moments, progress, paths, questions, matches, and ratings".
- DB-2: the concept graph is "node and edge tables queried with recursive SQL".
- DB-3: pgvector embeddings "filtered by rights, source, or difficulty in the same query".
- ING-1: the Python pipeline stores sources, content items and moments. The Next.js app reads them and writes users, progress and feedback.

Both sides need typed access to the same tables. Someone must own migrations. If each side defines the schema in its own ORM, the schema is written twice, which ARCH-2 forbids. Later, the Go game server (Phase 3) and the TS rating worker (MATCH-1) also touch Postgres.

Constraints: one engineer; few moving parts; heavy use of Postgres-specific features (recursive CTEs, pgvector, full-text search per DB-4, time partitioning per DB-7).

## Options

### A. TypeScript-owned migrations (Drizzle Kit or Prisma Migrate)

Schema defined in TS. Python gets types by hand-written pydantic models, SQLAlchemy reflection, or raw SQL.
- Pros: one schema definition close to the API. Good TS developer experience.
- Cons: Python's models are a second definition of the same schema (drift risk, ARCH-2). ORM schema DSLs cover pgvector, partitioning and recursive SQL partly or through raw SQL escapes. Couples the worker's deploy order to the web app's migration tool.
- Cost to reverse: medium. Migration history is in the tool's format; moving off it means regenerating a baseline.

### B. Python-owned migrations (Alembic)

Schema defined in SQLAlchemy models. TS gets types by introspection (kysely-codegen or similar) or hand-written types.
- Pros: Alembic is mature and handles Postgres features well through raw `op.execute`.
- Cons: the web app, which owns most user-facing tables (users, progress, guest sessions, entitlements), depends on the worker's codebase for every schema change. Python models plus TS types is a second definition unless TS is generated.
- Cost to reverse: medium.

### C. Tool-neutral plain SQL migrations, with types generated for both sides

Migrations are numbered `.sql` files in one place (for example `packages/db/migrations/`), applied by a small runner (dbmate, golang-migrate, or Atlas in versioned mode). CI applies them to an ephemeral Postgres with pgvector, then generates:
- TS types by introspection (for example kysely-codegen), used with a query builder or typed SQL.
- Python types by introspection (for example a generated pydantic or dataclass module), used with psycopg and plain SQL.
- Pros: the schema is written once, in SQL, which is what DB-2 and DB-3 lean on anyway. Neither runtime owns the other's deploy. The Go server (Phase 3) and rating worker can use the same migrations and generate their own types. Migrations read the same to any reviewer.
- Cons: no ORM model layer; queries are SQL or query-builder calls. Codegen for Python is less standard than for TS; may need a small script. One more tool (the migration runner).
- Cost to reverse: low. Plain SQL migrations can be imported into Alembic or Drizzle as a baseline.

### D. Each side owns its own tables

TS migrates user tables, Python migrates content tables.
- Pros: each codebase is self-contained.
- Cons: tables reference each other (progress → moments, feed → content). Cross-owner foreign keys and two migration histories against one database. Ordering bugs at deploy time.
- Cost to reverse: high once both histories exist.

## Recommendation (not a decision)

Option C. The schema is defined once (ARCH-2), in the language the DB decisions are written in (DB-2 recursive SQL, DB-3 pgvector filters, DB-4 full-text search). It keeps the Phase 3 Go server and TS rating worker on the same footing.

The exact runner and codegen tools are chosen in docs/proposals/phase-1-skeleton.md and need owner approval as dependencies.

## Consequences

- One migrations directory, applied by CI and by a local command.
- CI job: start Postgres with pgvector, apply all migrations, run codegen for TS and Python, fail if generated files differ from what is committed. Also fail if a migration was edited after merge.
- Generated type files are committed and never edited by hand.
- Migrations are applied in deploy before either deployable starts. Deploy is the owner's job (CLAUDE.md).
- Until this ADR is ACCEPTED, no slice writes migrations (CLAUDE.md).

## Open questions

- Migrations must be backward compatible for one release so the worker and web app can deploy in either order. Confirm.
- Who applies migrations in prod: a CDK custom resource, a one-off ECS task, or the owner by hand?
