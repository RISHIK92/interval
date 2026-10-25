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

    // Proposal section 9: separate queues so a backfill cannot starve feed recomputes.
    const queues = (["ingest", "feed"] as const).map((name) => {
      const dlq = new sqs.Queue(this, `${name}-dlq`, {
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
        encryption: sqs.QueueEncryption.SQS_MANAGED,
        deadLetterQueue: { queue: dlq, maxReceiveCount: 5 },
      });
    });
    const [ingest, feed] = queues;
    if (ingest === undefined || feed === undefined)
      throw new Error("queues missing");

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
      REDIS_URL: `rediss://${cache.attrPrimaryEndPointAddress}:6379`,
      SQS_INGEST_URL: ingest.queueUrl,
      SQS_FEED_URL: feed.queueUrl,
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
    new CfnOutput(this, "IngestQueueUrl", { value: ingest.queueUrl });
    new CfnOutput(this, "FeedQueueUrl", { value: feed.queueUrl });
    new CfnOutput(this, "DbEndpoint", { value: db.instanceEndpoint.hostname });
  }
}
