# Runbook: full-AWS deployment mode (ADR-0011)

CDK stack `interval-prod-aws` (infra/src/aws-stack.ts) in ap-south-1:
- CloudFront in front of a public ALB;
- the web app on Fargate in private subnets;
- RDS PostgreSQL 17 and ElastiCache Valkey in isolated subnets;
- SQS `ingest` and `feed`, each with a dead-letter queue;
- the S3 buckets `private-content` and `events`;
- one NAT gateway.

Per ADR-0013 nothing is deployed until every phase is built. The owner runs every step; Claude never deploys.

## Prerequisites
- AWS credentials for the prod account, region ap-south-1, and Docker on the deploying machine (CDK builds the arm64 images at deploy).

## First deploy
1. `pnpm --filter @interval/infra exec cdk bootstrap` (once per account and region).
2. `pnpm --filter @interval/infra exec cdk deploy interval-prod-aws`. Note the outputs: SiteDomain, ClusterName, MigrateTaskDefinition, JobsTaskDefinition, AppSecurityGroup, AppSubnets, the queue URLs, DbEndpoint.
3. Replace the placeholders with real keys (letters, digits, `_` and `-`):
   `aws secretsmanager put-secret-value --secret-id interval/aws/openrouter --secret-string '<key>'`, and the same for `interval/aws/voyage`.
4. Run migrations (ADR-0002) before the web service serves traffic:
   ```
   aws ecs run-task --cluster <ClusterName> --launch-type FARGATE \
     --task-definition <MigrateTaskDefinition> \
     --network-configuration 'awsvpcConfiguration={subnets=[<AppSubnets>],securityGroups=[<AppSecurityGroup>],assignPublicIp=DISABLED}'
   ```
   Wait for the task to stop with exit code 0 (`aws ecs describe-tasks`). Its logs are in the stack's CloudWatch log group under `migrate/`.
5. Open `https://<SiteDomain>/api/health`. It should return `{"status":"ok"}`.

## Update
1. Run `cdk deploy interval-prod-aws` again. CDK rebuilds the images and the web service rolls out with no downtime (minimum healthy 100%).
2. If the release adds migrations, run the migrate task first (step 4 above). Each migration stays compatible with the previous release.

## Run a job
The same `run-task` as migrations, with `<JobsTaskDefinition>` and
`--overrides '{"containerOverrides":[{"name":"jobs","command":["rebuild-feed"]}]}'`.

## Database
- TLS: every task connects with `sslmode=verify-full`, using the RDS CA bundle baked into the images (`/certs/rds-global-bundle.pem`).
- Backups: RDS automated backups are kept for 7 days. Deleting the stack leaves a final snapshot, and deletion protection is on.
- Never rotate `interval/aws/postgres` by hand without restarting every task. Tasks read the password at start.

## Not yet in this mode
- Custom domain and ACM certificate: CloudFront uses its default `*.cloudfront.net` domain.
- Alarm notifications: the DLQ alarms have no SNS target yet.
- The always-on worker service: it is added with the queue consumer in W2-S02.
