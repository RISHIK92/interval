# 0011. Two deployment modes: full AWS and single VM

- Status: ACCEPTED
- Date: 2026-10-25
- Supersedes: ADR-0005 (web and API hosting)
- Superseded by: none

## Decision (owner, 2026-10-25)

Interval supports two deployment modes from the same application code. Both are built now.

1. **Full AWS.** The web app and worker run on Fargate. Data and services use RDS for PostgreSQL (pgvector), ElastiCache (Redis), S3 and SQS. This is the shape in docs/decisions.md and its AWS mapping.
2. **Single VM.** One EC2 VM runs everything from one compose file: Postgres+pgvector, Redis, the web app, the worker, a queue (ElasticMQ), Caddy and, optionally, local S3 (SeaweedFS). This is the S08 stack.

Further choices:

- **Redis is in both modes now.** This overrides CACHE-1 ("No Redis in Phase 1") and moves CACHE-2's ElastiCache forward from Phase 3.
- **VM file storage is a switch.** The default is the real S3 buckets; the alternative is the SeaweedFS container, so everything stays on the VM.
- **VM backups are manual** (owner, 2026-10-25).

## Context

- ADR-0005 left the beta host open. The owner first chose a single VM (2026-10-25, no ADR), then asked for both modes.
- DB-1 (RDS), LOAD-1 (Fargate), LOAD-3 (SQS), CACHE-1/CACHE-2 (Redis timing) and DB-6 (S3) assume AWS managed services. Each one has a protocol-compatible container: Postgres, Redis, ElasticMQ for SQS, SeaweedFS for S3.
- Local dev already runs Postgres, ElasticMQ and SeaweedFS in Docker (Q-P1-26).

## Options

### A. One mode (VM or AWS)

- Pros: half the infra code.
- Cons: the owner wants both: cheap VM hosting now, a managed path when load or ops needs it.
- Cost to reverse: low.

### B. Two modes, same code, endpoints from configuration (chosen)

- Pros: switching is a deploy choice, not a rewrite. Local dev, the VM and AWS share one code path.
- Cons: two infra definitions to keep in sync (two CDK stacks plus a compose file). Features must be limited to what both the managed service and its container support (for example, SQS features ElasticMQ lacks).
- Cost to reverse: low; drop one mode's infra.

## Consequences

- **App configuration:** apps take every backing service from env: `DATABASE_URL`, `REDIS_URL`, `S3_ENDPOINT` (unset for AWS S3), `SQS_ENDPOINT` (unset for AWS SQS) and bucket and queue names. Code never branches on the mode.
- **CDK has two stacks:**
  - `interval-prod-vm` (S08): the VM, data volume, buckets and secrets.
  - `interval-prod-aws` (new slice): VPC with private subnets, RDS, ElastiCache, SQS with DLQs, Fargate web and worker behind an ALB and CloudFront, ECR, buckets and secrets.
  - CI synths both.
- **VM mode:** `deploy/compose.prod.yml` holds every container. Redis and the queue run there too, and SeaweedFS sits behind a compose profile.
- **CLAUDE.md:** the line "No Redis before Phase 3 (CACHE-1)" changes to point here.
- **Supersedes ADR-0005:** the hosting question is settled as both modes.

## Open questions

- Which mode the beta deploys to first. Suggested: VM (cheaper); the owner picks at deploy time.
- How Redis is used in Phase 1 before CACHE-2's features exist. Until a caller exists it is provisioned and health-checked only.
