import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
} from "aws-cdk-lib";
import * as athena from "aws-cdk-lib/aws-athena";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Platform } from "aws-cdk-lib/aws-ecr-assets";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elasticache from "aws-cdk-lib/aws-elasticache";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as glue from "aws-cdk-lib/aws-glue";
import * as logs from "aws-cdk-lib/aws-logs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import * as targets from "aws-cdk-lib/aws-scheduler-targets";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as sqs from "aws-cdk-lib/aws-sqs";
import type { Construct } from "constructs";
import {
  createBuckets,
  createEventStream,
  grantBookDeletes,
} from "./storage.ts";

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
    const dlqs: sqs.Queue[] = [];
    const queues = MESSAGE_NAMES.map((name) => {
      const dlq = new sqs.Queue(this, `${name}-dlq`, {
        queueName: `${queuePrefix}${name}-dlq`,
        encryption: sqs.QueueEncryption.SQS_MANAGED,
        retentionPeriod: Duration.days(14),
      });
      dlqs.push(dlq);
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

    // DB-5, P1-W6-S04: Athena reads the events Firehose writes, one prefix per day
    // (partition projection: no crawler, no partitions to add). `props` lists only the
    // props the saved queries read; the stack test pins them against the queries.
    const eventsDatabase = new glue.CfnDatabase(this, "EventsDatabase", {
      catalogId: this.account,
      databaseInput: { name: "interval_events" },
    });
    const eventsLocation = `s3://${events.bucketName}/events/`;
    const eventsTable = new glue.CfnTable(this, "EventsTable", {
      catalogId: this.account,
      databaseName: eventsDatabase.ref,
      tableInput: {
        name: "events",
        tableType: "EXTERNAL_TABLE",
        partitionKeys: [{ name: "dt", type: "string" }],
        parameters: {
          classification: "json",
          "projection.enabled": "true",
          "projection.dt.type": "date",
          "projection.dt.format": "yyyy-MM-dd",
          "projection.dt.range": "2026-10-01,NOW",
          "projection.dt.interval": "1",
          "projection.dt.interval.unit": "DAYS",
          "storage.location.template": `${eventsLocation}dt=\${dt}/`,
        },
        storageDescriptor: {
          location: eventsLocation,
          inputFormat: "org.apache.hadoop.mapred.TextInputFormat",
          outputFormat:
            "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
          serdeInfo: {
            serializationLibrary: "org.openx.data.jsonserde.JsonSerDe",
          },
          columns: [
            { name: "event_id", type: "string" },
            { name: "occurred_at", type: "string" },
            { name: "user_id", type: "string" },
            { name: "is_guest", type: "boolean" },
            { name: "beta_group", type: "string" },
            { name: "session_id", type: "string" },
            { name: "source", type: "string" },
            { name: "name", type: "string" },
            { name: "version", type: "int" },
            {
              name: "props",
              type: "struct<kind:string,item_id:string,moment_id:string,method:string,question_id:string,path_id:string,section_id:string,passed:boolean>",
            },
          ],
        },
      },
    });
    // Query results are throwaway: kept a month, then expired.
    events.addLifecycleRule({
      prefix: "athena-results/",
      expiration: Duration.days(30),
    });
    const workGroup = new athena.CfnWorkGroup(this, "EventsWorkGroup", {
      name: "interval-events",
      // The saved queries go with it when the stack is deleted.
      recursiveDeleteOption: true,
      workGroupConfiguration: {
        enforceWorkGroupConfiguration: true,
        // OPS-4: the queries read the whole events prefix; 10 GB per query is far above
        // beta volume and stops a runaway scan.
        bytesScannedCutoffPerQuery: 10 * 1024 ** 3,
        resultConfiguration: {
          outputLocation: `s3://${events.bucketName}/athena-results/`,
          encryptionConfiguration: { encryptionOption: "SSE_S3" },
        },
      },
    });
    // Phase 1 (Q-P1-21) and Phase 2 (P2-W9-S08, Q-P2-20) "done when": the SQL lives in
    // the repo, tested with DuckDB on fixture events
    // (workers/jobs/tests/test_metric_queries.py).
    for (const [id, file, description] of [
      [
        "ReturnRateQuery",
        "return_rate.sql",
        "Users who return the week after signup",
      ],
      [
        "FinishedRateQuery",
        "finished_rate.sql",
        "Opened items marked finished",
      ],
      [
        "QuizRateQuery",
        "quiz_rate.sql",
        "Finished moments that lead to a quiz",
      ],
      ["FlagRateQuery", "flag_rate.sql", "Answered questions that get flagged"],
      [
        "QuizReturnQuery",
        "quiz_return.sql",
        "Return rate of quiz takers and non-takers",
      ],
      [
        "PathProgressQuery",
        "path_progress.sql",
        "Sections passed per active path in the last full week",
      ],
    ] as const) {
      const query = new athena.CfnNamedQuery(this, id, {
        name: file.replace(".sql", ""),
        description,
        database: eventsDatabase.ref,
        workGroup: workGroup.name,
        queryString: readFileSync(
          path.join(REPO_ROOT, "packages/events/queries", file),
          "utf8",
        ),
      });
      query.addResourceDependency(workGroup);
      query.addResourceDependency(eventsTable);
    }

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
    // P2-W12-S01 (ADR-0024): the GitHub App's, placeholders until the owner registers it;
    // the web app alone connects GitHub (the worker's App id and key come with S02).
    const githubSlug = appSecret("interval/aws/github-app-slug");
    const githubClientId = appSecret("interval/aws/github-app-client-id");
    const githubClientSecret = appSecret(
      "interval/aws/github-app-client-secret",
    );
    // S02: the App's id and private key, for the worker's reads (base64 PEM for the key).
    const githubAppId = appSecret("interval/aws/github-app-id");
    const githubPrivateKey = appSecret("interval/aws/github-app-private-key");

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
    // P2-W11-S03: a scanned page (or book) OCR gave up on; the book finishes without it.
    logGroup.addMetricFilter("BookOcrGaveUp", {
      filterPattern: logs.FilterPattern.stringValue(
        "$.msg",
        "=",
        "books: ocr gave up",
      ),
      metricNamespace: "Interval/Books",
      metricName: "OcrGaveUp",
      metricValue: "1",
    });
    // P2-W11-S01: a deleted book whose file couldn't be removed (it expires anyway).
    logGroup.addMetricFilter("BookFilesNotRemoved", {
      filterPattern: logs.FilterPattern.stringValue(
        "$.msg",
        "=",
        "books: file not removed",
      ),
      metricNamespace: "Interval/Books",
      metricName: "FilesNotRemoved",
      metricValue: "1",
    });
    // LOAD-5 (W4-S04): a failed feed recompute keeps the last feed and is counted.
    const recomputeFailures = logGroup.addMetricFilter(
      "FeedRecomputeFailures",
      {
        filterPattern: logs.FilterPattern.stringValue(
          "$.msg",
          "=",
          "feed: recompute failed",
        ),
        metricNamespace: "Interval/Feed",
        metricName: "RecomputeFailures",
        metricValue: "1",
      },
    );
    // OPS-4: the AI gateway logs each call's cost and each refusal (Q-P1-23).
    const aiCost = logGroup.addMetricFilter("AiCost", {
      filterPattern: logs.FilterPattern.stringValue("$.msg", "=", "ai: call"),
      metricNamespace: "Interval/AI",
      metricName: "CostMicroUsd",
      metricValue: "$.cost_micro_usd",
    });
    const aiOverBudget = logGroup.addMetricFilter("AiOverBudget", {
      filterPattern: logs.FilterPattern.stringValue(
        "$.msg",
        "=",
        "ai: over budget",
      ),
      metricNamespace: "Interval/AI",
      metricName: "OverBudget",
      metricValue: "1",
    });

    // OPS-2 (W6-S05): the web app logs each feed page's time (server/feed.ts) ...
    const feedLatency = logGroup.addMetricFilter("FeedLatency", {
      filterPattern: logs.FilterPattern.stringValue(
        "$.msg",
        "=",
        "feed: served",
      ),
      metricNamespace: "Interval/Feed",
      metricName: "FeedLatencyMs",
      metricValue: "$.duration_ms",
      unit: cloudwatch.Unit.MILLISECONDS,
      // A new guest's first page may wait up to 3 s for its feed: kept apart.
      dimensions: { From: "$.from" },
    });
    // ... and both queue adapters log each failed stage delivery, by queue.
    const deliveryFailures = logGroup.addMetricFilter("QueueDeliveryFailures", {
      filterPattern: logs.FilterPattern.stringValue(
        "$.msg",
        "=",
        "queue: delivery failed",
      ),
      metricNamespace: "Interval/Queue",
      metricName: "DeliveryFailures",
      metricValue: "1",
      dimensions: { Queue: "$.queue" },
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

    const taskDefinition = (
      name: string,
      memoryLimitMiB = 1024,
    ): ecs.FargateTaskDefinition =>
      new ecs.FargateTaskDefinition(this, `${name}Task`, {
        cpu: 512,
        memoryLimitMiB,
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
      secrets: {
        ...secrets,
        GITHUB_APP_SLUG: ecs.Secret.fromSecretsManager(githubSlug),
        GITHUB_APP_CLIENT_ID: ecs.Secret.fromSecretsManager(githubClientId),
        GITHUB_APP_CLIENT_SECRET:
          ecs.Secret.fromSecretsManager(githubClientSecret),
      },
      portMappings: [{ containerPort: 3000 }],
      logging: logging("web"),
    });
    privateContent.grantRead(webTask.taskRole);
    privateContent.grantPut(webTask.taskRole);
    grantBookDeletes(privateContent, webTask.taskRole);
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
    // The worker removes a deleted book's file (remove_file), with the queue's retries.
    grantBookDeletes(privateContent, jobsTask.taskRole);
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

    // Q-P2-40 (P2-W12-S02): EventBridge Scheduler runs `sync-github-due` daily. It
    // queues a read per connected user active this week; it may only send to the
    // github_sync queue.
    const syncGitHubDueTask = taskDefinition("SyncGitHubDue");
    syncGitHubDueTask.addContainer("sync-github-due", {
      image: image("workers/jobs/Dockerfile"),
      entryPoint: withDatabaseUrl(
        '/app/.venv/bin/python -m interval_jobs "$@"',
      ),
      command: ["sync-github-due"],
      environment,
      secrets: { DB_PASSWORD: secrets.DB_PASSWORD },
      logging: logging("sync-github-due"),
    });
    const githubSyncQueue = queues[MESSAGE_NAMES.indexOf("github_sync")];
    if (githubSyncQueue === undefined) {
      throw new Error("packages/db/messages has no github_sync schema");
    }
    githubSyncQueue.grantSendMessages(syncGitHubDueTask.taskRole);
    new scheduler.Schedule(this, "SyncGitHubDueSchedule", {
      schedule: scheduler.ScheduleExpression.rate(Duration.days(1)),
      target: new targets.EcsRunFargateTask(cluster, {
        taskDefinition: syncGitHubDueTask,
        securityGroups: [appSg],
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        // A missed day only means yesterday's repositories a day longer.
        retryAttempts: 2,
        maxEventAge: Duration.hours(1),
      }),
    });

    // Q-2 (P2-W8-S03): EventBridge Scheduler runs `spot-check-due` weekly. It only
    // marks questions for review in the database: no queue to send to.
    const spotCheckDueTask = taskDefinition("SpotCheckDue");
    spotCheckDueTask.addContainer("spot-check-due", {
      image: image("workers/jobs/Dockerfile"),
      entryPoint: withDatabaseUrl(
        '/app/.venv/bin/python -m interval_jobs "$@"',
      ),
      command: ["spot-check-due"],
      environment,
      secrets: { DB_PASSWORD: secrets.DB_PASSWORD },
      logging: logging("spot-check-due"),
    });
    new scheduler.Schedule(this, "SpotCheckDueSchedule", {
      schedule: scheduler.ScheduleExpression.rate(Duration.days(7)),
      target: new targets.EcsRunFargateTask(cluster, {
        taskDefinition: spotCheckDueTask,
        securityGroups: [appSg],
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        // A missed run would skip a week's sample; a rerun queues nothing twice.
        retryAttempts: 2,
        maxEventAge: Duration.hours(1),
      }),
    });

    // Q-3 (P2-W9-S08): EventBridge Scheduler runs `recalibrate-difficulty` weekly. It
    // reads answers and writes levels and reviews in the database: no queue, no model.
    const recalibrateTask = taskDefinition("RecalibrateDifficulty");
    recalibrateTask.addContainer("recalibrate-difficulty", {
      image: image("workers/jobs/Dockerfile"),
      entryPoint: withDatabaseUrl(
        '/app/.venv/bin/python -m interval_jobs "$@"',
      ),
      command: ["recalibrate-difficulty"],
      environment,
      secrets: { DB_PASSWORD: secrets.DB_PASSWORD },
      logging: logging("recalibrate-difficulty"),
    });
    new scheduler.Schedule(this, "RecalibrateDifficultySchedule", {
      schedule: scheduler.ScheduleExpression.rate(Duration.days(7)),
      target: new targets.EcsRunFargateTask(cluster, {
        taskDefinition: recalibrateTask,
        securityGroups: [appSg],
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        // A missed week leaves levels a week older; a rerun only refits.
        retryAttempts: 2,
        maxEventAge: Duration.hours(1),
      }),
    });

    // Q-P2-13 (P2-W8-S05): EventBridge Scheduler runs `question-batches` every 30
    // minutes: it calls the model (the OpenRouter key) and writes the database; no
    // queue to send to.
    const questionBatchesTask = taskDefinition("QuestionBatches");
    questionBatchesTask.addContainer("question-batches", {
      image: image("workers/jobs/Dockerfile"),
      entryPoint: withDatabaseUrl(
        '/app/.venv/bin/python -m interval_jobs "$@"',
      ),
      command: ["question-batches"],
      environment,
      // Only what it uses: the database and the model provider.
      secrets: {
        DB_PASSWORD: secrets.DB_PASSWORD,
        OPENROUTER_API_KEY: secrets.OPENROUTER_API_KEY,
      },
      logging: logging("question-batches"),
    });
    new scheduler.Schedule(this, "QuestionBatchesSchedule", {
      schedule: scheduler.ScheduleExpression.rate(Duration.minutes(30)),
      target: new targets.EcsRunFargateTask(cluster, {
        taskDefinition: questionBatchesTask,
        securityGroups: [appSg],
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        // The next run picks up whatever this one missed.
        retryAttempts: 0,
        maxEventAge: Duration.minutes(30),
      }),
    });

    // PER-4 (P2-W12-S03): EventBridge Scheduler runs `suggest-technologies` weekly: it
    // asks the model about packages the curated table doesn't claim and stores the
    // replies for the owner's review; no queue to send to.
    const suggestTechnologiesTask = taskDefinition("SuggestTechnologies");
    suggestTechnologiesTask.addContainer("suggest-technologies", {
      image: image("workers/jobs/Dockerfile"),
      entryPoint: withDatabaseUrl(
        '/app/.venv/bin/python -m interval_jobs "$@"',
      ),
      command: ["suggest-technologies"],
      environment,
      secrets: {
        DB_PASSWORD: secrets.DB_PASSWORD,
        OPENROUTER_API_KEY: secrets.OPENROUTER_API_KEY,
      },
      logging: logging("suggest-technologies"),
    });
    new scheduler.Schedule(this, "SuggestTechnologiesSchedule", {
      schedule: scheduler.ScheduleExpression.rate(Duration.days(7)),
      target: new targets.EcsRunFargateTask(cluster, {
        taskDefinition: suggestTechnologiesTask,
        securityGroups: [appSg],
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        // The next week picks up whatever this one missed.
        retryAttempts: 0,
        maxEventAge: Duration.hours(1),
      }),
    });

    // The ingestion pipeline's consumer (W2-S02b): one always-on task serving every
    // stage queue. Same image and grants as the one-off jobs.
    // 2 GB: the consumer plus the OCR sidecar's 512 MB (ADR-0022).
    const workerTask = taskDefinition("Worker", 2048);
    workerTask.addContainer("worker", {
      image: image("workers/jobs/Dockerfile"),
      entryPoint: withDatabaseUrl(
        '/app/.venv/bin/python -m interval_jobs "$@"',
      ),
      command: ["consume"],
      // ADR-0022: the OCR sidecar, on the task's own network.
      environment: { ...environment, OCR_URL: "http://localhost:8080" },
      secrets: {
        ...secrets,
        GITHUB_APP_ID: ecs.Secret.fromSecretsManager(githubAppId),
        GITHUB_APP_PRIVATE_KEY: ecs.Secret.fromSecretsManager(githubPrivateKey),
      },
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
    // ADR-0022, ADR-0023, P2-W11-S03: Tesseract beside the consumer, which alone calls
    // it; one page at a time, capped at 512 MB as on the VM.
    workerTask.addContainer("ocr", {
      image: ecs.ContainerImage.fromAsset(path.join(REPO_ROOT, "deploy/ocr"), {
        platform: Platform.LINUX_ARM64,
      }),
      memoryLimitMiB: 512,
      // ADR-0023: a crashed OCR container holds up scanned pages only, as on the VM;
      // the consumer keeps serving every other stage.
      essential: false,
      logging: logging("ocr"),
    });
    // P2-W11: books read (book_process, ocr_page) and removed (remove_file) here.
    privateContent.grantRead(workerTask.taskRole);
    grantBookDeletes(privateContent, workerTask.taskRole);
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

    // OPS-2, OPS-4 (W6-S05): one dashboard and the alarms. No alarm notifies anyone
    // yet; they show in the console (owner, 2026-10-26; paging is out of scope).
    const fiveMinutes = Duration.minutes(5);
    const target5xx = alb.metrics.httpCodeTarget(
      elbv2.HttpCodeTarget.TARGET_5XX_COUNT,
      { period: fiveMinutes, statistic: "Sum" },
    );
    // Target 5xx plus the load balancer's own (502-504 when the web task is down),
    // over all requests; quiet windows (under 20 requests) count as 0, so one bad
    // request in a quiet beta hour doesn't fire it.
    const errorRate = new cloudwatch.MathExpression({
      expression:
        "IF(requests >= 20, 100 * (FILL(errors, 0) + FILL(elb, 0)) / requests, 0)",
      usingMetrics: {
        errors: target5xx,
        elb: alb.metrics.httpCodeElb(elbv2.HttpCodeElb.ELB_5XX_COUNT, {
          period: fiveMinutes,
          statistic: "Sum",
        }),
        requests: alb.metrics.requestCount({
          period: fiveMinutes,
          statistic: "Sum",
        }),
      },
      label: "5xx rate (%)",
      period: fiveMinutes,
    });
    new cloudwatch.Alarm(this, "Http5xxRate", {
      metric: errorRate,
      threshold: 5,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription:
        "More than 5% of requests answered 5xx, 10 minutes running",
    });
    const overBudget = aiOverBudget.metric({
      period: fiveMinutes,
      statistic: "Sum",
    });
    new cloudwatch.Alarm(this, "AiBudgetBreach", {
      metric: overBudget,
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: "An AI call was refused over budget (OPS-4)",
    });
    const latency = (from: string, stat: string) =>
      feedLatency.metric({
        dimensionsMap: { From: from },
        period: fiveMinutes,
        statistic: stat,
        label: `${from} ${stat}`,
      });
    new cloudwatch.Dashboard(this, "Dashboard", {
      dashboardName: "interval",
      // Whole days for the per-day cost widgets.
      defaultInterval: Duration.days(7),
      widgets: [
        [
          new cloudwatch.GraphWidget({
            title: "AI cost per day (micro-USD)",
            left: [
              aiCost.metric({ period: Duration.days(1), statistic: "Sum" }),
            ],
            width: 12,
          }),
          new cloudwatch.LogQueryWidget({
            title: "AI cost per user per day (USD)",
            logGroupNames: [logGroup.logGroupName],
            queryLines: [
              'filter msg = "ai: call"',
              "stats sum(cost_micro_usd) / 1000000 as usd by user_id, bin(1d)",
              "sort usd desc",
              "limit 50",
            ],
            width: 12,
          }),
        ],
        [
          new cloudwatch.GraphWidget({
            title: "Feed latency (ms)",
            left: [
              latency("user", "p50"),
              latency("user", "p95"),
              latency("starter", "p95"),
            ],
            width: 12,
          }),
          new cloudwatch.GraphWidget({
            title: "5xx rate (%)",
            left: [errorRate],
            width: 12,
          }),
        ],
        [
          new cloudwatch.GraphWidget({
            title: "Stage delivery failures",
            left: [
              ...MESSAGE_NAMES.map((name) =>
                deliveryFailures.metric({
                  dimensionsMap: { Queue: name },
                  period: fiveMinutes,
                  statistic: "Sum",
                  label: name,
                }),
              ),
              recomputeFailures.metric({
                period: fiveMinutes,
                statistic: "Sum",
                label: "feed recompute",
              }),
            ],
            width: 12,
          }),
          new cloudwatch.GraphWidget({
            title: "Dead-letter queue depth",
            left: dlqs.map((dlq) =>
              dlq.metricApproximateNumberOfMessagesVisible({
                label: dlq.node.id,
              }),
            ),
            width: 12,
          }),
        ],
        [
          new cloudwatch.GraphWidget({
            title: "AI calls refused over budget",
            left: [overBudget],
            width: 12,
          }),
        ],
      ],
    });

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
