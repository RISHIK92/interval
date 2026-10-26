import { readdirSync } from "node:fs";
import path from "node:path";
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
} from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Platform } from "aws-cdk-lib/aws-ecr-assets";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elasticache from "aws-cdk-lib/aws-elasticache";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as logs from "aws-cdk-lib/aws-logs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import * as targets from "aws-cdk-lib/aws-scheduler-targets";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as sqs from "aws-cdk-lib/aws-sqs";
import type { Construct } from "constructs";
import { createBuckets, createEventStream } from "./storage.ts";

// Full-AWS deployment mode (ADR-0011): Fargate, RDS, ElastiCache (Valkey), SQS, S3,
// behind CloudFront. Same env contract as the VM mode, so the apps do not change.
// Synth only until every phase is built (ADR-0013).

const REPO_ROOT = path.join(import.meta.dirname, "../..");
const DB_USER = "interval";
// Generated secrets stay URL-safe: they are placed into DATABASE_URL unencoded.
const URL_UNSAFE = " %+~`#$&*()|[]{}:;<>?!'/@\"\\,=^";
const SECRET_GENERATION = {
  passwordLength: 48,
  excludePunctuation: true,
} as const;
const ORIGIN_HEADER = "X-Origin-Verify";

// Builds DATABASE_URL from the injected parts, then runs the given program. Plain
// `$VAR` (no braces): CloudFormation validation reads `${...}` as its own syntax.
// TLS to RDS is verified against the RDS CA bundle baked into every image (the pg
// driver treats `require` as verify-full anyway, and needs the CA to trust RDS).
const withDatabaseUrl = (program: string): string[] => [
  "sh",
  "-c",
  `export DATABASE_URL="postgres://${DB_USER}:$DB_PASSWORD@$DB_HOST:$DB_PORT/interval?sslmode=verify-full&sslrootcert=/certs/rds-global-bundle.pem" && exec ${program}`,
  "interval",
];

// The queue messages (ADR-0010): one SQS queue each.
const MESSAGE_NAMES = readdirSync(
  path.join(import.meta.dirname, "../../packages/db/messages"),
)
  .filter((file) => file.endsWith(".schema.json"))
  .map((file) => file.replace(".schema.json", ""))
  .sort();

export class AwsStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        { name: "public", subnetType: ec2.SubnetType.PUBLIC },
        { name: "app", subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        { name: "data", subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      ],
      gatewayEndpoints: {
        S3: { service: ec2.GatewayVpcEndpointAwsService.S3 },
      },
    });

    const albSg = new ec2.SecurityGroup(this, "AlbSg", {
      vpc,
      description: "Public load balancer behind CloudFront",
    });
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80));
    const appSg = new ec2.SecurityGroup(this, "AppSg", {
      vpc,
      description: "Web, jobs and migrate tasks",
    });
    appSg.addIngressRule(albSg, ec2.Port.tcp(3000));
    const dataSg = new ec2.SecurityGroup(this, "DataSg", {
      vpc,
      description: "Postgres and Valkey, reachable from the app tasks only",
      allowAllOutbound: false,
    });
    dataSg.addIngressRule(appSg, ec2.Port.tcp(5432));
    dataSg.addIngressRule(appSg, ec2.Port.tcp(6379));

    const db = new rds.DatabaseInstance(this, "Db", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_17_9,
      }),
      instanceType: new ec2.InstanceType("t4g.small"),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dataSg],
      databaseName: "interval",
      credentials: rds.Credentials.fromGeneratedSecret(DB_USER, {
        secretName: "interval/aws/postgres",
        excludeCharacters: URL_UNSAFE,
      }),
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      publiclyAccessible: false,
      multiAz: false,
      backupRetention: Duration.days(7),
      deletionProtection: true,
      removalPolicy: RemovalPolicy.SNAPSHOT,
    });
    const dbSecret = db.secret;
    if (dbSecret === undefined)
      throw new Error("database has no generated secret");

    const cacheSubnets = new elasticache.CfnSubnetGroup(this, "CacheSubnets", {
      description: "Valkey in the isolated data subnets",
      subnetIds: vpc.isolatedSubnets.map((s) => s.subnetId),
    });
    const cache = new elasticache.CfnReplicationGroup(this, "Cache", {
      replicationGroupDescription: "Interval Valkey (ADR-0011)",
      engine: "valkey",
      engineVersion: "8.0",
      cacheNodeType: "cache.t4g.micro",
      numCacheClusters: 1,
      atRestEncryptionEnabled: true,
      transitEncryptionEnabled: true,
      cacheSubnetGroupName: cacheSubnets.ref,
      securityGroupIds: [dataSg.securityGroupId],
    });

    // ADR-0014: one queue per message schema (ADR-0010), named so the apps can build
    // its URL from SQS_QUEUE_URL_PREFIX plus the message name. Separate queues also keep
    // a backfill from starving feed recomputes (proposal section 9).
    const queuePrefix = `${this.stackName}-`;
    const queues = MESSAGE_NAMES.map((name) => {
      const dlq = new sqs.Queue(this, `${name}-dlq`, {
        queueName: `${queuePrefix}${name}-dlq`,
        encryption: sqs.QueueEncryption.SQS_MANAGED,
        retentionPeriod: Duration.days(14),
      });
      new cloudwatch.Alarm(this, `${name}-dlq-not-empty`, {
        metric: dlq.metricApproximateNumberOfMessagesVisible(),
        threshold: 0,
        comparisonOperator:
          cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: 1,
        alarmDescription: `Messages in the ${name} dead-letter queue`,
      });
      return new sqs.Queue(this, name, {
        queueName: `${queuePrefix}${name}`,
        encryption: sqs.QueueEncryption.SQS_MANAGED,
        // A stage may run for minutes (fetch, extract); it must not be redelivered
        // while still running.
        visibilityTimeout: Duration.minutes(5),
        // 3 deliveries, then the DLQ: the port's ATTEMPTS (ADR-0014).
        deadLetterQueue: { queue: dlq, maxReceiveCount: 3 },
      });
    });
    const queueUrlPrefix = `https://sqs.${this.region}.${this.urlSuffix}/${this.account}/${queuePrefix}`;

    const { privateContent, events } = createBuckets(this);
    const eventStream = createEventStream(
      this,
      events,
      "interval-prod-aws-events",
    );

    const appSecret = (name: string): secretsmanager.Secret =>
      new secretsmanager.Secret(this, name.replaceAll("/", "-"), {
        secretName: name,
        generateSecretString: { ...SECRET_GENERATION },
        removalPolicy: RemovalPolicy.RETAIN,
      });
    const betterAuth = appSecret("interval/aws/better-auth");
    // Generated placeholders: the owner replaces them with the real API keys (ADR-0007).
    const openrouter = appSecret("interval/aws/openrouter");
    const voyage = appSecret("interval/aws/voyage");
    const originVerify = appSecret("interval/aws/origin-verify");

    const cluster = new ecs.Cluster(this, "Cluster", { vpc });
    const logGroup = new logs.LogGroup(this, "Logs", {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    // DB-5: the emitters log each drop with a count; this sums them into a metric.
    logGroup.addMetricFilter("EventEmitFailures", {
      filterPattern: logs.FilterPattern.stringValue(
        "$.msg",
        "=",
        "events: emit failed",
      ),
      metricNamespace: "Interval/Events",
      metricName: "EmitFailures",
      metricValue: "$.count",
    });
    // LOAD-5 (W4-S04): a failed feed recompute keeps the last feed and is counted.
    logGroup.addMetricFilter("FeedRecomputeFailures", {
      filterPattern: logs.FilterPattern.stringValue(
        "$.msg",
        "=",
        "feed: recompute failed",
      ),
      metricNamespace: "Interval/Feed",
      metricName: "RecomputeFailures",
      metricValue: "1",
    });
    // OPS-4: the AI gateway logs each call's cost and each refusal (Q-P1-23).
    logGroup.addMetricFilter("AiCost", {
      filterPattern: logs.FilterPattern.stringValue("$.msg", "=", "ai: call"),
      metricNamespace: "Interval/AI",
      metricName: "CostMicroUsd",
      metricValue: "$.cost_micro_usd",
    });
    logGroup.addMetricFilter("AiOverBudget", {
      filterPattern: logs.FilterPattern.stringValue(
        "$.msg",
        "=",
        "ai: over budget",
      ),
      metricNamespace: "Interval/AI",
      metricName: "OverBudget",
      metricValue: "1",
    });

    const environment = {
      NODE_ENV: "production",
      DB_HOST: db.instanceEndpoint.hostname,
      DB_PORT: db.instanceEndpoint.port.toString(),
      VALKEY_URL: `rediss://${cache.attrPrimaryEndPointAddress}:6379`,
      QUEUE_TRANSPORT: "sqs",
      SQS_QUEUE_URL_PREFIX: queueUrlPrefix,
      PRIVATE_CONTENT_BUCKET: privateContent.bucketName,
      EVENTS_BUCKET: events.bucketName,
      // DB-5: both apps send events through Firehose.
      EVENTS_TRANSPORT: "firehose",
      EVENTS_STREAM: eventStream.deliveryStreamName,
      AWS_REGION: Stack.of(this).region,
      // Lets the worker CLI's local-only database guard accept the RDS host here.
      INTERVAL_RUNTIME: "aws",
    };
    const secrets = {
      DB_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, "password"),
      BETTER_AUTH_SECRET: ecs.Secret.fromSecretsManager(betterAuth),
      OPENROUTER_API_KEY: ecs.Secret.fromSecretsManager(openrouter),
      VOYAGE_API_KEY: ecs.Secret.fromSecretsManager(voyage),
    };

    const taskDefinition = (name: string): ecs.FargateTaskDefinition =>
      new ecs.FargateTaskDefinition(this, `${name}Task`, {
        cpu: 512,
        memoryLimitMiB: 1024,
        runtimePlatform: {
          cpuArchitecture: ecs.CpuArchitecture.ARM64,
          operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        },
      });
    const image = (file: string): ecs.ContainerImage =>
      ecs.ContainerImage.fromAsset(REPO_ROOT, {
        file,
        platform: Platform.LINUX_ARM64,
      });
    const logging = (prefix: string): ecs.LogDriver =>
      ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: prefix });

    const webTask = taskDefinition("Web");
    const webContainer = webTask.addContainer("web", {
      image: image("apps/web/Dockerfile"),
      command: withDatabaseUrl("node apps/web/server.js"),
      environment,
      secrets,
      portMappings: [{ containerPort: 3000 }],
      logging: logging("web"),
    });
    privateContent.grantRead(webTask.taskRole);
    privateContent.grantPut(webTask.taskRole);
    eventStream.grantPutRecords(webTask.taskRole);
    // ADR-0014: the web app enqueues; only the worker consumes.
    for (const queue of queues) queue.grantSendMessages(webTask.taskRole);

    const web = new ecs.FargateService(this, "WebService", {
      cluster,
      taskDefinition: webTask,
      desiredCount: 1,
      // Start the new task before stopping the old one: one task, no deploy downtime.
      minHealthyPercent: 100,
      securityGroups: [appSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      circuitBreaker: { rollback: true },
    });
    web
      .autoScaleTaskCount({ minCapacity: 1, maxCapacity: 3 })
      .scaleOnCpuUtilization("Cpu", { targetUtilizationPercent: 60 });

    // One-off tasks the owner runs with `aws ecs run-task` (docs/runbooks/aws.md).
    const jobsTask = taskDefinition("Jobs");
    jobsTask.addContainer("jobs", {
      image: image("workers/jobs/Dockerfile"),
      entryPoint: withDatabaseUrl(
        '/app/.venv/bin/python -m interval_jobs "$@"',
      ),
      environment,
      secrets,
      logging: logging("jobs"),
    });
    privateContent.grantRead(jobsTask.taskRole);
    privateContent.grantPut(jobsTask.taskRole);
    eventStream.grantPutRecords(jobsTask.taskRole);
    for (const queue of queues) {
      queue.grantSendMessages(jobsTask.taskRole);
      queue.grantConsumeMessages(jobsTask.taskRole);
    }

    // ING-3 (W2-S03): EventBridge Scheduler runs `poll-due` every 5 minutes. A task
    // definition of its own carries the command, so the schedule needs no overrides,
    // and its role may only send to the queues.
    const pollDueTask = taskDefinition("PollDue");
    pollDueTask.addContainer("poll-due", {
      image: image("workers/jobs/Dockerfile"),
      entryPoint: withDatabaseUrl(
        '/app/.venv/bin/python -m interval_jobs "$@"',
      ),
      command: ["poll-due"],
      environment,
      secrets: { DB_PASSWORD: secrets.DB_PASSWORD },
      logging: logging("poll-due"),
    });
    eventStream.grantPutRecords(pollDueTask.taskRole);
    for (const queue of queues) queue.grantSendMessages(pollDueTask.taskRole);
    new scheduler.Schedule(this, "PollDueSchedule", {
      schedule: scheduler.ScheduleExpression.rate(Duration.minutes(5)),
      target: new targets.EcsRunFargateTask(cluster, {
        taskDefinition: pollDueTask,
        securityGroups: [appSg],
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        // The next run 5 minutes on picks up whatever a failed one missed.
        retryAttempts: 0,
        maxEventAge: Duration.minutes(5),
      }),
    });

    // Q-P1-17 (W4-S04): EventBridge Scheduler runs `recompute-due` hourly. It queues a
    // feed recompute per active user (the consumer runs them) and refreshes the
    // starter feeds itself; like poll-due, its role may only send to the queues.
    const recomputeDueTask = taskDefinition("RecomputeDue");
    recomputeDueTask.addContainer("recompute-due", {
      image: image("workers/jobs/Dockerfile"),
      entryPoint: withDatabaseUrl(
        '/app/.venv/bin/python -m interval_jobs "$@"',
      ),
      command: ["recompute-due"],
      environment,
      secrets: { DB_PASSWORD: secrets.DB_PASSWORD },
      logging: logging("recompute-due"),
    });
    // It emits no events and queues only recompute_feed, and polish_note for the
    // starter feeds' new notes (P1-W4-S06).
    for (const name of ["recompute_feed", "polish_note"] as const) {
      const queue = queues[MESSAGE_NAMES.indexOf(name)];
      if (queue === undefined) {
        throw new Error(`packages/db/messages has no ${name} schema`);
      }
      queue.grantSendMessages(recomputeDueTask.taskRole);
    }
    new scheduler.Schedule(this, "RecomputeDueSchedule", {
      schedule: scheduler.ScheduleExpression.rate(Duration.hours(1)),
      target: new targets.EcsRunFargateTask(cluster, {
        taskDefinition: recomputeDueTask,
        securityGroups: [appSg],
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        // The next hour covers every active user again; no retry needed.
        retryAttempts: 0,
        maxEventAge: Duration.hours(1),
      }),
    });

    // ING-6 (W6-S03): EventBridge Scheduler runs `check-links-due` weekly. It queues
    // a status check of every item (the consumer runs them); its role may only send
    // to the check_link queue.
    const checkLinksDueTask = taskDefinition("CheckLinksDue");
    checkLinksDueTask.addContainer("check-links-due", {
      image: image("workers/jobs/Dockerfile"),
      entryPoint: withDatabaseUrl(
        '/app/.venv/bin/python -m interval_jobs "$@"',
      ),
      command: ["check-links-due"],
      environment,
      secrets: { DB_PASSWORD: secrets.DB_PASSWORD },
      logging: logging("check-links-due"),
    });
    const checkLinkQueue = queues[MESSAGE_NAMES.indexOf("check_link")];
    if (checkLinkQueue === undefined) {
      throw new Error("packages/db/messages has no check_link schema");
    }
    checkLinkQueue.grantSendMessages(checkLinksDueTask.taskRole);
    new scheduler.Schedule(this, "CheckLinksDueSchedule", {
      schedule: scheduler.ScheduleExpression.rate(Duration.days(7)),
      target: new targets.EcsRunFargateTask(cluster, {
        taskDefinition: checkLinksDueTask,
        securityGroups: [appSg],
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        // A missed run would leave a week unchecked; a retry only re-attempts a
        // failed RunTask, and a check is idempotent anyway.
        retryAttempts: 2,
        maxEventAge: Duration.hours(1),
      }),
    });

    // The ingestion pipeline's consumer (W2-S02b): one always-on task serving every
    // stage queue. Same image and grants as the one-off jobs.
    const workerTask = taskDefinition("Worker");
    workerTask.addContainer("worker", {
      image: image("workers/jobs/Dockerfile"),
      entryPoint: withDatabaseUrl(
        '/app/.venv/bin/python -m interval_jobs "$@"',
      ),
      command: ["consume"],
      environment,
      secrets,
      logging: logging("worker"),
      // Let in-flight stages finish, as on the VM (compose stop_grace_period).
      stopTimeout: Duration.seconds(60),
      // Liveness: the consumer touches this file every 30 s; ECS replaces the task
      // when it goes stale.
      healthCheck: {
        command: [
          "CMD-SHELL",
          'test -n "$(find /tmp/interval-consumer-alive -mmin -2)"',
        ],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(60),
      },
    });
    // No S3: stages keep fetched pages in memory.
    eventStream.grantPutRecords(workerTask.taskRole);
    for (const queue of queues) {
      queue.grantSendMessages(workerTask.taskRole);
      queue.grantConsumeMessages(workerTask.taskRole);
    }
    new ecs.FargateService(this, "WorkerService", {
      cluster,
      taskDefinition: workerTask,
      desiredCount: 1,
      securityGroups: [appSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      circuitBreaker: { rollback: true },
    });

    const migrateTask = taskDefinition("Migrate");
    migrateTask.addContainer("migrate", {
      image: image("packages/db/Dockerfile"),
      entryPoint: withDatabaseUrl(
        "dbmate --migrations-dir /migrations --no-dump-schema --wait up",
      ),
      environment,
      secrets,
      logging: logging("migrate"),
    });

    const alb = new elbv2.ApplicationLoadBalancer(this, "Alb", {
      vpc,
      internetFacing: true,
      securityGroup: albSg,
    });
    const headerValue = originVerify.secretValue.unsafeUnwrap(); // a dynamic reference
    const listener = alb.addListener("Http", {
      port: 80,
      open: false,
      defaultAction: elbv2.ListenerAction.fixedResponse(403, {
        contentType: "text/plain",
        messageBody: "Forbidden",
      }),
    });
    // Only CloudFront knows the header, so the ALB never serves the app directly.
    listener.addTargets("Web", {
      priority: 1,
      conditions: [
        elbv2.ListenerCondition.httpHeader(ORIGIN_HEADER, [headerValue]),
      ],
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [web],
      healthCheck: { path: "/api/health", healthyHttpCodes: "200" },
    });

    const origin = new origins.LoadBalancerV2Origin(alb, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
      customHeaders: { [ORIGIN_HEADER]: headerValue },
    });
    const distribution = new cloudfront.Distribution(this, "Cdn", {
      defaultBehavior: {
        origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      },
      // CACHE-4: Next.js static assets are content-hashed and safe to cache.
      additionalBehaviors: {
        "/_next/static/*": {
          origin,
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        },
      },
    });

    // Better Auth's public origin (ADR-0004); known only once the distribution exists.
    webContainer.addEnvironment(
      "BETTER_AUTH_URL",
      `https://${distribution.distributionDomainName}`,
    );

    new CfnOutput(this, "SiteDomain", {
      value: distribution.distributionDomainName,
    });
    new CfnOutput(this, "ClusterName", { value: cluster.clusterName });
    new CfnOutput(this, "MigrateTaskDefinition", {
      value: migrateTask.taskDefinitionArn,
    });
    new CfnOutput(this, "JobsTaskDefinition", {
      value: jobsTask.taskDefinitionArn,
    });
    new CfnOutput(this, "AppSecurityGroup", { value: appSg.securityGroupId });
    new CfnOutput(this, "AppSubnets", {
      value: vpc.privateSubnets.map((s) => s.subnetId).join(","),
    });
    new CfnOutput(this, "QueueUrlPrefix", { value: queueUrlPrefix });
    new CfnOutput(this, "DbEndpoint", { value: db.instanceEndpoint.hostname });
  }
}
