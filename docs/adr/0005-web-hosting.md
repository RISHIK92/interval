# 0005. Web and API hosting in Phase 1

- Status: SUPERSEDED (owner, 2026-10-25)
- Date: 2026-10-25
- Supersedes: none
- Superseded by: ADR-0011

## Owner input (2026-10-25)

Not decided. What is settled:
- Weeks 1–5 run locally only (Docker Compose). CDK stays synth-only until then.
- The AWS host is picked before the Week 6 beta. The options below still apply.
- One AWS environment: prod only. Local is dev (Q-P1-28).
- Region: ap-south-1 (Mumbai).
- Host choice deferred again on 2026-10-25: decide around Week 5.
- No domain name yet. Decide before Week 6. Local dev uses localhost.

## Context

- ARCH-1: Phase 1 deployables are "Next.js full-stack app and a Python worker". One app serves pages and API.
- LOAD-1: "Stateless API containers on Fargate that autoscale."
- AWS mapping: "API, workers, game server | ECS on Fargate" and "Web app | Amplify Hosting or Fargate".
- Mermaid diagram: "Next.js API - TS" serves the PWA, Expo apps and the agent hook CLI.
- DB-1: RDS Postgres. CACHE-4: CloudFront for static assets. OPS-2: CloudWatch and OpenTelemetry.
- LOAD-5: "A cached feed is the fallback". CACHE-1: precomputed feeds in Postgres.

The mapping leaves open whether web and API are one deployable or two in Phase 1, and where it runs.

## Options

### A. One Next.js deployable on ECS Fargate behind an ALB, CloudFront in front

Pages and route handlers in one container image. CloudFront caches `/_next/static` and public assets.
- Pros: matches ARCH-1 (one full-stack app) and LOAD-1 (Fargate containers). Long-lived processes keep a small, steady RDS connection pool, so no RDS Proxy is needed. Same platform as the Python worker. OpenTelemetry runs as usual in a container. No cold starts.
- Cons: always-on cost: at least one Fargate task plus an ALB, roughly $30–50/month for dev and again for prod (estimate; verify). You own the Dockerfile, health checks and deploy rollout.
- Cost to reverse: low. The same Next.js build can move to Amplify or Lambda later.

### B. One Next.js deployable on Amplify Hosting

Amplify runs SSR and route handlers on its managed compute.
- Pros: least infrastructure to write. Preview deploys per branch. Low idle cost.
- Cons: the API does not run on Fargate (deviates from LOAD-1). Serverless-style compute opens many short connections to RDS, which usually means RDS Proxy. Less control over runtime, OpenTelemetry setup and network placement inside the VPC (verify Amplify's current VPC support before accepting). CDK support for Amplify Hosting is thinner than for ECS.
- Cost to reverse: low to medium.

### C. Two deployables: web on Amplify, API on Fargate

- Pros: each piece on its "natural" host.
- Cons: three deployables in Phase 1, which contradicts ARCH-1. Two places to handle auth and CORS. The API is still a Next.js app or a second framework.
- Cost to reverse: medium.

### D. Next.js on Lambda via OpenNext

- Pros: low idle cost, CloudFront-native.
- Cons: not in the AWS mapping. Same RDS connection issue as B. Another build adapter to maintain.
- Cost to reverse: low to medium.

## Recommendation (not a decision)

Option A. It is the only option that satisfies both ARCH-1 (one full-stack deployable) and LOAD-1 (Fargate API) as written, and the mapping explicitly allows Fargate for the web app. It also keeps one compute platform for both Phase 1 deployables. The always-on cost is the trade-off; if it matters, run dev at one small task and scale it to zero outside work hours.

## Consequences

- CDK stacks in Phase 1: network (VPC), data (RDS, S3), app (ECS cluster, Fargate service for web, ALB, CloudFront), worker (Fargate service or tasks, SQS, EventBridge), events (Firehose), email (SES; auth is Better Auth in the web app, per ADR-0004), observability.
- Next.js builds with `output: "standalone"` into a container image in ECR.
- The agent hook CLI (Phase 3) and Expo apps (Phase 4) call the same API host.

## Open questions

- Domain name and DNS (Route 53?). Needed for auth email links, SES and the PWA. Not yet chosen (owner, 2026-10-25). Product name is still open (Part IV item 8).
- Region: answered, ap-south-1 (see Owner input).
