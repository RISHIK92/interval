import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, expect, test } from "vitest";
import { AwsStack } from "./aws-stack.ts";
import {
  expectEventStream,
  firehoseActionsFor,
} from "./events-stream.test-helpers.ts";

type Resource = {
  Properties: Record<string, unknown>;
  DeletionPolicy?: string;
};

let template: Template;
let json: string;

beforeAll(() => {
  const app = new App();
  const stack = new AwsStack(app, "interval-prod-aws", {
    env: { region: "ap-south-1" },
  });
  template = Template.fromStack(stack);
  json = JSON.stringify(template.toJSON());
});

function all(type: string): [string, Resource][] {
  return Object.entries(template.findResources(type)) as [string, Resource][];
}

function only(type: string): [string, Resource] {
  const found = all(type);
  expect(found).toHaveLength(1);
  const first = found[0];
  if (first === undefined) throw new Error(`no ${type}`);
  return first;
}

function groupId(description: string): string {
  const match = all("AWS::EC2::SecurityGroup").find(
    ([, sg]) => sg.Properties["GroupDescription"] === description,
  );
  if (match === undefined)
    throw new Error(`no security group "${description}"`);
  return match[0];
}

describe("network", () => {
  test("one NAT gateway and an S3 gateway endpoint", () => {
    template.resourceCountIs("AWS::EC2::NatGateway", 1);
    template.hasResourceProperties("AWS::EC2::VPCEndpoint", {
      VpcEndpointType: "Gateway",
      ServiceName: Match.objectLike({
        "Fn::Join": Match.arrayWith([Match.arrayWith([".s3"])]),
      }),
    });
  });
});

describe("database", () => {
  test("Postgres 17, encrypted, private, protected, 7-day backups", () => {
    const [, db] = only("AWS::RDS::DBInstance");
    expect(db.Properties).toMatchObject({
      Engine: "postgres",
      DBInstanceClass: "db.t4g.small",
      StorageEncrypted: true,
      PubliclyAccessible: false,
      DeletionProtection: true,
      BackupRetentionPeriod: 7,
      MultiAZ: false,
    });
    expect(String(db.Properties["EngineVersion"])).toMatch(/^17\./);
    expect(db.DeletionPolicy).toBe("Snapshot");
  });

  test("Postgres and Valkey accept connections only from the app security group", () => {
    const app = groupId("Web, jobs and migrate tasks");
    const ingress = all("AWS::EC2::SecurityGroupIngress").map(
      ([, r]) => r.Properties,
    );
    for (const port of [5432, 6379]) {
      const rules = ingress.filter((p) => p["FromPort"] === port);
      expect(rules.length).toBeGreaterThan(0);
      for (const rule of rules) {
        expect(rule["SourceSecurityGroupId"]).toEqual({
          "Fn::GetAtt": [app, "GroupId"],
        });
        expect(rule["CidrIp"]).toBeUndefined();
      }
    }
  });
});

describe("cache", () => {
  test("Valkey with encryption at rest and in transit", () => {
    const [, cache] = only("AWS::ElastiCache::ReplicationGroup");
    expect(cache.Properties).toMatchObject({
      Engine: "valkey",
      CacheNodeType: "cache.t4g.micro",
      NumCacheClusters: 1,
      AtRestEncryptionEnabled: true,
      TransitEncryptionEnabled: true,
    });
  });
});

describe("queues (ADR-0014)", () => {
  // One queue per message schema in packages/db/messages, so a new message gets its
  // queue without touching infra.
  const names = readdirSync(
    path.join(import.meta.dirname, "../../packages/db/messages"),
  )
    .filter((file) => file.endsWith(".schema.json"))
    .map((file) => file.replace(".schema.json", ""));

  test("each message has a queue that redrives to its DLQ after 3 receives", () => {
    expect(names).toContain("discover_source");
    template.resourceCountIs("AWS::SQS::Queue", names.length * 2);
    for (const name of names) {
      template.hasResourceProperties("AWS::SQS::Queue", {
        QueueName: `interval-prod-aws-${name}`,
        SqsManagedSseEnabled: true,
        RedrivePolicy: Match.objectLike({ maxReceiveCount: 3 }),
      });
      template.hasResourceProperties("AWS::SQS::Queue", {
        QueueName: `interval-prod-aws-${name}-dlq`,
        MessageRetentionPeriod: 14 * 24 * 3600,
      });
    }
    const alarms = all("AWS::CloudWatch::Alarm").filter(
      ([, a]) =>
        a.Properties["MetricName"] === "ApproximateNumberOfMessagesVisible",
    );
    expect(alarms).toHaveLength(names.length);
  });

  test("web may only send; jobs may send and consume; migrate gets nothing", () => {
    const sqsActions = (rolePrefix: string): Set<string> => {
      const actions = new Set<string>();
      for (const [, policy] of all("AWS::IAM::Policy")) {
        const props = policy.Properties as {
          Roles: { Ref: string }[];
          PolicyDocument: { Statement: { Action: string | string[] }[] };
        };
        if (!props.Roles.some((r) => r.Ref.startsWith(rolePrefix))) continue;
        for (const statement of props.PolicyDocument.Statement) {
          for (const action of [statement.Action].flat()) {
            if (action.startsWith("sqs:")) actions.add(action);
          }
        }
      }
      return actions;
    };
    const web = sqsActions("WebTaskTaskRole");
    expect(web.has("sqs:SendMessage")).toBe(true);
    expect(web.has("sqs:ReceiveMessage")).toBe(false);
    expect(web.has("sqs:DeleteMessage")).toBe(false);
    const jobs = sqsActions("JobsTaskTaskRole");
    for (const action of [
      "sqs:SendMessage",
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
    ]) {
      expect(jobs.has(action)).toBe(true);
    }
    expect(sqsActions("MigrateTaskTaskRole").size).toBe(0);
  });

  test("web and jobs reach the queues through the prefix; Valkey via VALKEY_URL", () => {
    const containers = all("AWS::ECS::TaskDefinition").flatMap(
      ([, task]) =>
        task.Properties["ContainerDefinitions"] as {
          Name: string;
          Environment?: { Name: string; Value: unknown }[];
        }[],
    );
    for (const name of ["web", "jobs"]) {
      const env = containers.find((c) => c.Name === name)?.Environment ?? [];
      const keys = env.map((e) => e.Name);
      expect(keys).toEqual(
        expect.arrayContaining([
          "QUEUE_TRANSPORT",
          "SQS_QUEUE_URL_PREFIX",
          "VALKEY_URL",
        ]),
      );
      expect(keys).not.toContain("REDIS_URL");
      expect(keys).not.toContain("SQS_INGEST_URL");
      expect(env.find((e) => e.Name === "QUEUE_TRANSPORT")?.Value).toBe("sqs");
    }
  });
});

describe("edge", () => {
  test("CloudFront caches only /_next/static, redirects to HTTPS, sends the secret header", () => {
    const [, dist] = only("AWS::CloudFront::Distribution");
    const config = dist.Properties["DistributionConfig"] as {
      DefaultCacheBehavior: {
        CachePolicyId: string;
        ViewerProtocolPolicy: string;
      };
      CacheBehaviors: { PathPattern: string; CachePolicyId: string }[];
      Origins: {
        OriginCustomHeaders: { HeaderName: string; HeaderValue: unknown }[];
      }[];
    };
    // AWS managed policy ids: CachingDisabled and CachingOptimized.
    expect(config.DefaultCacheBehavior.CachePolicyId).toBe(
      "4135ea2d-6df8-44a3-9df3-4b5a84be39ad",
    );
    expect(config.DefaultCacheBehavior.ViewerProtocolPolicy).toBe(
      "redirect-to-https",
    );
    const statics = config.CacheBehaviors.find(
      (b) => b.PathPattern === "/_next/static/*",
    );
    expect(statics?.CachePolicyId).toBe("658327ea-f89d-4fab-a63d-7e88639e58f6");
    const header = config.Origins[0]?.OriginCustomHeaders.find(
      (h) => h.HeaderName === "X-Origin-Verify",
    );
    expect(JSON.stringify(header?.HeaderValue)).toContain(
      "resolve:secretsmanager",
    );
  });

  test("the ALB refuses requests without the CloudFront header", () => {
    template.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
      DefaultActions: [
        Match.objectLike({
          Type: "fixed-response",
          FixedResponseConfig: Match.objectLike({ StatusCode: "403" }),
        }),
      ],
    });
    const [, rule] = only("AWS::ElasticLoadBalancingV2::ListenerRule");
    expect(JSON.stringify(rule.Properties["Conditions"])).toContain(
      "X-Origin-Verify",
    );
    expect(JSON.stringify(rule.Properties["Conditions"])).toContain(
      "resolve:secretsmanager",
    );
  });
});

describe("containers", () => {
  test("ARM64 tasks get secrets only through ECS secrets, never plain env", () => {
    const tasks = all("AWS::ECS::TaskDefinition");
    // web, jobs, worker, migrate, poll-due, recompute-due, check-links-due,
    // spot-check-due
    expect(tasks.length).toBe(8);
    for (const [, task] of tasks) {
      expect(task.Properties["RuntimePlatform"]).toMatchObject({
        CpuArchitecture: "ARM64",
      });
      const containers = task.Properties["ContainerDefinitions"] as {
        Environment?: { Name: string }[];
        Secrets?: { Name: string }[];
      }[];
      for (const c of containers) {
        const names = (c.Environment ?? []).map((e) => e.Name);
        expect(names).not.toContain("DB_PASSWORD");
        expect(names).not.toContain("BETTER_AUTH_SECRET");
        expect(names).not.toContain("OPENROUTER_API_KEY");
        expect(
          names.some((n) => n.endsWith("_KEY") || n.endsWith("SECRET")),
        ).toBe(false);
        expect((c.Secrets ?? []).map((s) => s.Name)).toContain("DB_PASSWORD");
      }
    }
  });

  test("the web container gets both Better Auth settings, or it exits at startup", () => {
    const web = all("AWS::ECS::TaskDefinition")
      .flatMap(
        ([, task]) =>
          task.Properties["ContainerDefinitions"] as {
            Name: string;
            Environment?: { Name: string }[];
            Secrets?: { Name: string }[];
          }[],
      )
      .find((c) => c.Name === "web");
    expect((web?.Environment ?? []).map((e) => e.Name)).toContain(
      "BETTER_AUTH_URL",
    );
    expect((web?.Secrets ?? []).map((s) => s.Name)).toContain(
      "BETTER_AUTH_SECRET",
    );
  });

  test("the web service checks /api/health and scales 1 to 3", () => {
    template.hasResourceProperties("AWS::ElasticLoadBalancingV2::TargetGroup", {
      HealthCheckPath: "/api/health",
    });
    template.hasResourceProperties(
      "AWS::ApplicationAutoScaling::ScalableTarget",
      {
        MinCapacity: 1,
        MaxCapacity: 3,
      },
    );
  });

  test("every task connects to RDS with verified TLS", () => {
    for (const [, task] of all("AWS::ECS::TaskDefinition")) {
      const text = JSON.stringify(task.Properties["ContainerDefinitions"]);
      expect(text).toContain(
        "sslmode=verify-full&sslrootcert=/certs/rds-global-bundle.pem",
      );
    }
  });

  test("no secret value is written into the template", () => {
    expect(json).not.toMatch(/"SecretString"/);
  });
});

describe("events (DB-5, AWS mode)", () => {
  test("one Firehose stream writes date-partitioned events to the Events bucket", () => {
    expectEventStream(template, "interval-prod-aws-events");
  });

  test("web and jobs may only put records to the stream; migrate gets nothing", () => {
    for (const role of ["WebTaskTaskRole", "JobsTaskTaskRole"]) {
      expect(firehoseActionsFor(template, role)).toEqual([
        "firehose:PutRecord",
        "firehose:PutRecordBatch",
      ]);
    }
    expect(firehoseActionsFor(template, "MigrateTaskTaskRole")).toEqual([]);
  });

  test("web and jobs send events to the stream", () => {
    const containers = all("AWS::ECS::TaskDefinition").flatMap(
      ([, task]) =>
        task.Properties["ContainerDefinitions"] as {
          Name: string;
          Environment?: { Name: string; Value: unknown }[];
        }[],
    );
    for (const name of ["web", "jobs"]) {
      const env = containers.find((c) => c.Name === name)?.Environment ?? [];
      const value = (key: string) => env.find((e) => e.Name === key)?.Value;
      expect(value("EVENTS_TRANSPORT")).toBe("firehose");
      expect(value("EVENTS_STREAM")).toBeDefined();
      expect(value("AWS_REGION")).toBe("ap-south-1");
    }
  });

  test("dropped events become a CloudWatch metric", () => {
    template.hasResourceProperties("AWS::Logs::MetricFilter", {
      FilterPattern: '{ $.msg = "events: emit failed" }',
      MetricTransformations: [
        Match.objectLike({
          MetricNamespace: "Interval/Events",
          MetricName: "EmitFailures",
          MetricValue: "$.count",
        }),
      ],
    });
  });
});

describe("AI cost metrics (OPS-4, Q-P1-23)", () => {
  test("the gateway's call and over-budget log lines become metrics", () => {
    template.hasResourceProperties("AWS::Logs::MetricFilter", {
      FilterPattern: '{ $.msg = "ai: call" }',
      MetricTransformations: [
        Match.objectLike({
          MetricNamespace: "Interval/AI",
          MetricName: "CostMicroUsd",
          MetricValue: "$.cost_micro_usd",
        }),
      ],
    });
    template.hasResourceProperties("AWS::Logs::MetricFilter", {
      FilterPattern: '{ $.msg = "ai: over budget" }',
      MetricTransformations: [
        Match.objectLike({
          MetricNamespace: "Interval/AI",
          MetricName: "OverBudget",
          MetricValue: "1",
        }),
      ],
    });
  });
});

describe("pipeline worker (W2-S02b)", () => {
  test("one always-on worker task consumes the queues, with a heartbeat check", () => {
    template.hasResourceProperties("AWS::ECS::Service", {
      DesiredCount: 1,
      TaskDefinition: Match.objectLike({
        Ref: Match.stringLikeRegexp("^WorkerTask"),
      }),
    });
    const worker = all("AWS::ECS::TaskDefinition")
      .flatMap(
        ([, task]) =>
          task.Properties["ContainerDefinitions"] as {
            Name: string;
            Command?: string[];
            HealthCheck?: { Command: string[] };
          }[],
      )
      .find((c) => c.Name === "worker");
    expect(worker?.Command).toEqual(["consume"]);
    expect(worker?.HealthCheck?.Command.join(" ")).toContain(
      "/tmp/interval-consumer-alive",
    );
  });
});

describe("adaptive polling (W2-S03, ING-3)", () => {
  test("EventBridge Scheduler runs poll-due every 5 minutes as a Fargate task", () => {
    template.hasResourceProperties("AWS::Scheduler::Schedule", {
      ScheduleExpression: "rate(5 minutes)",
      FlexibleTimeWindow: { Mode: "OFF" },
      Target: Match.objectLike({
        EcsParameters: Match.objectLike({
          LaunchType: "FARGATE",
          TaskDefinitionArn: { Ref: Match.stringLikeRegexp("^PollDueTask") },
        }),
      }),
    });
    const container = all("AWS::ECS::TaskDefinition")
      .flatMap(
        ([, task]) =>
          task.Properties["ContainerDefinitions"] as {
            Name: string;
            Command?: string[];
          }[],
      )
      .find((c) => c.Name === "poll-due");
    expect(container?.Command).toEqual(["poll-due"]);
  });

  test("poll-due may send to the queues but never consume them", () => {
    const actions = new Set<string>();
    for (const [, policy] of all("AWS::IAM::Policy")) {
      const props = policy.Properties as {
        Roles: { Ref: string }[];
        PolicyDocument: { Statement: { Action: string | string[] }[] };
      };
      if (!props.Roles.some((r) => r.Ref.startsWith("PollDueTaskTaskRole"))) {
        continue;
      }
      for (const statement of props.PolicyDocument.Statement) {
        for (const action of [statement.Action].flat()) actions.add(action);
      }
    }
    expect(actions.has("sqs:SendMessage")).toBe(true);
    expect(actions.has("sqs:ReceiveMessage")).toBe(false);
    expect([...actions].some((a) => a.startsWith("s3:"))).toBe(false);
  });

  test("the schedule runs in the app subnets, never retries, and may run only poll-due", () => {
    const schedule = scheduleFor("PollDueTask");
    const target = schedule.Properties["Target"] as {
      RetryPolicy: {
        MaximumRetryAttempts: number;
        MaximumEventAgeInSeconds: number;
      };
      EcsParameters: {
        NetworkConfiguration: {
          AwsvpcConfiguration: {
            AssignPublicIp?: string;
            SecurityGroups: unknown[];
          };
        };
      };
    };
    expect(target.RetryPolicy).toEqual({
      MaximumRetryAttempts: 0,
      MaximumEventAgeInSeconds: 300,
    });
    const network =
      target.EcsParameters.NetworkConfiguration.AwsvpcConfiguration;
    expect(network.AssignPublicIp ?? "DISABLED").toBe("DISABLED");
    expect(JSON.stringify(network.SecurityGroups)).toContain("AppSg");
    // Each schedule's role may run its own task only.
    const runTask = all("AWS::IAM::Policy").flatMap(([, policy]) =>
      (
        policy.Properties["PolicyDocument"] as {
          Statement: { Action: string | string[]; Resource: unknown }[];
        }
      ).Statement.filter((st) => [st.Action].flat().includes("ecs:RunTask")),
    );
    expect(runTask).toHaveLength(4);
    const targets = runTask.map((st) => JSON.stringify(st.Resource));
    expect(targets.filter((t) => t.includes("PollDueTask"))).toHaveLength(1);
    expect(targets.filter((t) => t.includes("RecomputeDueTask"))).toHaveLength(
      1,
    );
    expect(targets.filter((t) => t.includes("CheckLinksDueTask"))).toHaveLength(
      1,
    );
    expect(targets.filter((t) => t.includes("SpotCheckDueTask"))).toHaveLength(
      1,
    );
  });

  test("poll-due gets the database password and no other secret", () => {
    const container = all("AWS::ECS::TaskDefinition")
      .flatMap(
        ([, task]) =>
          task.Properties["ContainerDefinitions"] as {
            Name: string;
            Secrets?: { Name: string }[];
          }[],
      )
      .find((c) => c.Name === "poll-due");
    expect((container?.Secrets ?? []).map((x) => x.Name)).toEqual([
      "DB_PASSWORD",
    ]);
  });
});

function scheduleFor(taskPrefix: string): Resource {
  const found = all("AWS::Scheduler::Schedule").find(([, schedule]) =>
    JSON.stringify(schedule.Properties["Target"]).includes(taskPrefix),
  );
  if (found === undefined) throw new Error(`no schedule runs ${taskPrefix}`);
  return found[1];
}

function containerNamed(name: string) {
  return all("AWS::ECS::TaskDefinition")
    .flatMap(
      ([, task]) =>
        task.Properties["ContainerDefinitions"] as {
          Name: string;
          Command?: string[];
          Secrets?: { Name: string }[];
        }[],
    )
    .find((c) => c.Name === name);
}

describe("precomputed feeds (W4-S04, Q-P1-17)", () => {
  test("EventBridge Scheduler runs recompute-due hourly as a Fargate task", () => {
    const schedule = scheduleFor("RecomputeDueTask");
    expect(schedule.Properties["ScheduleExpression"]).toBe("rate(1 hour)");
    expect(containerNamed("recompute-due")?.Command).toEqual(["recompute-due"]);
    // A missed hour needs no retry: the next run covers every active user again.
    expect(
      (schedule.Properties["Target"] as { RetryPolicy: unknown }).RetryPolicy,
    ).toEqual({ MaximumRetryAttempts: 0, MaximumEventAgeInSeconds: 3600 });
  });

  test("recompute-due may send to the queues, never consume, and has only the DB secret", () => {
    const actions = new Set<string>();
    for (const [, policy] of all("AWS::IAM::Policy")) {
      const props = policy.Properties as {
        Roles: { Ref: string }[];
        PolicyDocument: { Statement: { Action: string | string[] }[] };
      };
      if (
        !props.Roles.some((r) => r.Ref.startsWith("RecomputeDueTaskTaskRole"))
      ) {
        continue;
      }
      for (const statement of props.PolicyDocument.Statement) {
        for (const action of [statement.Action].flat()) actions.add(action);
      }
    }
    expect(actions.has("sqs:SendMessage")).toBe(true);
    expect(actions.has("sqs:ReceiveMessage")).toBe(false);
    expect([...actions].some((a) => a.startsWith("firehose:"))).toBe(false);
    expect(
      (containerNamed("recompute-due")?.Secrets ?? []).map((x) => x.Name),
    ).toEqual(["DB_PASSWORD"]);
    // Only the recompute_feed and polish_note queues: least privilege.
    const sends = all("AWS::IAM::Policy")
      .filter(([, policy]) =>
        (policy.Properties["Roles"] as { Ref: string }[]).some((r) =>
          r.Ref.startsWith("RecomputeDueTaskTaskRole"),
        ),
      )
      .flatMap(([, policy]) =>
        (
          policy.Properties["PolicyDocument"] as {
            Statement: { Action: string | string[]; Resource: unknown }[];
          }
        ).Statement.filter((st) =>
          [st.Action].flat().includes("sqs:SendMessage"),
        ),
      );
    const resources = JSON.stringify(sends.map((st) => st.Resource));
    expect(resources).toContain("recomputefeed");
    expect(resources).toContain("polishnote");
    expect(sends.flatMap((st) => [st.Resource].flat())).toHaveLength(2);
  });

  test("a failed recompute becomes a CloudWatch metric (LOAD-5)", () => {
    template.hasResourceProperties("AWS::Logs::MetricFilter", {
      FilterPattern: '{ $.msg = "feed: recompute failed" }',
      MetricTransformations: [
        Match.objectLike({
          MetricNamespace: "Interval/Feed",
          MetricName: "RecomputeFailures",
          MetricValue: "1",
        }),
      ],
    });
  });
});

describe("weekly link health checks (W6-S03, ING-6)", () => {
  test("EventBridge Scheduler runs check-links-due weekly as a Fargate task", () => {
    const schedule = scheduleFor("CheckLinksDueTask");
    expect(schedule.Properties["ScheduleExpression"]).toBe("rate(7 days)");
    expect(containerNamed("check-links-due")?.Command).toEqual([
      "check-links-due",
    ]);
    // Retried: a missed run would leave a whole week unchecked, and a check is
    // idempotent, so a repeat does no harm.
    expect(
      (schedule.Properties["Target"] as { RetryPolicy: unknown }).RetryPolicy,
    ).toEqual({ MaximumRetryAttempts: 2, MaximumEventAgeInSeconds: 3600 });
  });

  test("check-links-due may send only to the check_link queue, with only the DB secret", () => {
    const policies = all("AWS::IAM::Policy").filter(([, policy]) =>
      (policy.Properties["Roles"] as { Ref: string }[]).some((r) =>
        r.Ref.startsWith("CheckLinksDueTaskTaskRole"),
      ),
    );
    const statements = policies.flatMap(
      ([, policy]) =>
        (
          policy.Properties["PolicyDocument"] as {
            Statement: { Action: string | string[]; Resource: unknown }[];
          }
        ).Statement,
    );
    const actions = new Set(statements.flatMap((st) => [st.Action].flat()));
    expect(actions.has("sqs:SendMessage")).toBe(true);
    expect(actions.has("sqs:ReceiveMessage")).toBe(false);
    expect([...actions].some((a) => a.startsWith("firehose:"))).toBe(false);
    const sends = statements.filter((st) =>
      [st.Action].flat().includes("sqs:SendMessage"),
    );
    expect(JSON.stringify(sends.map((st) => st.Resource))).toContain(
      "checklink",
    );
    expect(sends.flatMap((st) => [st.Resource].flat())).toHaveLength(1);
    expect(
      (containerNamed("check-links-due")?.Secrets ?? []).map((x) => x.Name),
    ).toEqual(["DB_PASSWORD"]);
  });
});

describe("Athena metric queries (W6-S04, DB-5)", () => {
  const QUERIES = path.join(
    import.meta.dirname,
    "../../packages/events/queries",
  );
  const PROPS =
    "struct<kind:string,item_id:string,moment_id:string,method:string>";

  test("a Glue table reads the Firehose events by day, with partition projection", () => {
    const [table] = all("AWS::Glue::Table");
    expect(table).toBeDefined();
    const input = table?.[1].Properties["TableInput"] as {
      Name: string;
      PartitionKeys: { Name: string; Type: string }[];
      Parameters: Record<string, string>;
      StorageDescriptor: {
        Location: unknown;
        SerdeInfo: { SerializationLibrary: string };
        Columns: { Name: string; Type: string }[];
      };
    };
    expect(input.Name).toBe("events");
    expect(input.PartitionKeys).toEqual([{ Name: "dt", Type: "string" }]);
    expect(input.Parameters["projection.enabled"]).toBe("true");
    expect(input.Parameters["projection.dt.type"]).toBe("date");
    expect(input.Parameters["projection.dt.format"]).toBe("yyyy-MM-dd");
    // The same prefix Firehose writes to (storage.ts).
    expect(
      JSON.stringify(input.Parameters["storage.location.template"]),
    ).toContain("/events/dt=${dt}/");
    expect(JSON.stringify(input.StorageDescriptor.Location)).toContain(
      "/events/",
    );
    expect(input.StorageDescriptor.SerdeInfo.SerializationLibrary).toBe(
      "org.openx.data.jsonserde.JsonSerDe",
    );
    const columns = Object.fromEntries(
      input.StorageDescriptor.Columns.map((c) => [c.Name, c.Type]),
    );
    expect(columns).toEqual({
      event_id: "string",
      occurred_at: "string",
      user_id: "string",
      is_guest: "boolean",
      beta_group: "string",
      session_id: "string",
      source: "string",
      name: "string",
      version: "int",
      props: PROPS,
    });
  });

  test("every prop the queries read is in the table's props struct", () => {
    const declared = new Set(
      [...PROPS.matchAll(/(\w+):string/g)].map((m) => m[1]),
    );
    for (const file of ["return_rate.sql", "finished_rate.sql"]) {
      const sql = readFileSync(path.join(QUERIES, file), "utf8");
      for (const [, prop] of sql.matchAll(/props\.(\w+)/g)) {
        expect(declared).toContain(prop);
      }
    }
  });

  test("an enforced workgroup writes results, encrypted, under athena-results/", () => {
    template.hasResourceProperties("AWS::Athena::WorkGroup", {
      Name: "interval-events",
      RecursiveDeleteOption: true,
      WorkGroupConfiguration: Match.objectLike({
        EnforceWorkGroupConfiguration: true,
        BytesScannedCutoffPerQuery: 10 * 1024 ** 3,
        ResultConfiguration: Match.objectLike({
          EncryptionConfiguration: { EncryptionOption: "SSE_S3" },
        }),
      }),
    });
    const [workgroup] = all("AWS::Athena::WorkGroup");
    expect(
      JSON.stringify(workgroup?.[1].Properties["WorkGroupConfiguration"]),
    ).toContain("/athena-results/");
  });

  test("query results expire after 30 days", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({
            Prefix: "athena-results/",
            ExpirationInDays: 30,
            Status: "Enabled",
          }),
        ]),
      },
    });
  });

  test("both metrics are saved queries carrying the repo's SQL", () => {
    const saved = all("AWS::Athena::NamedQuery").map(
      ([, q]) =>
        q.Properties as {
          QueryString: string;
          Database: string;
          WorkGroup: string;
        },
    );
    expect(saved).toHaveLength(2);
    for (const file of ["return_rate.sql", "finished_rate.sql"]) {
      const sql = readFileSync(path.join(QUERIES, file), "utf8");
      expect(saved.map((q) => q.QueryString)).toContain(sql);
    }
    for (const q of saved) {
      expect(JSON.stringify(q.Database)).toContain("EventsDatabase");
      expect(q.WorkGroup).toBe("interval-events");
    }
  });
});

describe("dashboards and alarms (W6-S05, OPS-2, OPS-4)", () => {
  function filterNamed(metricName: string) {
    const found = all("AWS::Logs::MetricFilter").find(([, f]) =>
      JSON.stringify(f.Properties["MetricTransformations"]).includes(
        `"MetricName":"${metricName}"`,
      ),
    );
    if (found === undefined) throw new Error(`no filter for ${metricName}`);
    return found[1].Properties as {
      FilterPattern: string;
      MetricTransformations: {
        MetricNamespace: string;
        MetricValue: string;
        Dimensions?: { Key: string; Value: string }[];
      }[];
    };
  }

  test("feed latency and failed deliveries become metrics", () => {
    const latency = filterNamed("FeedLatencyMs");
    expect(latency.FilterPattern).toBe('{ $.msg = "feed: served" }');
    expect(latency.MetricTransformations[0]).toMatchObject({
      MetricNamespace: "Interval/Feed",
      MetricValue: "$.duration_ms",
      Dimensions: [{ Key: "From", Value: "$.from" }],
    });
    const failures = filterNamed("DeliveryFailures");
    expect(failures.FilterPattern).toBe('{ $.msg = "queue: delivery failed" }');
    expect(failures.MetricTransformations[0]).toMatchObject({
      MetricNamespace: "Interval/Queue",
      MetricValue: "1",
      Dimensions: [{ Key: "Queue", Value: "$.queue" }],
    });
  });

  test("one dashboard shows AI cost, per-user cost, latency, failures, DLQs, 5xx and budget", () => {
    const dashboards = all("AWS::CloudWatch::Dashboard");
    expect(dashboards).toHaveLength(1);
    const body = JSON.stringify(dashboards[0]?.[1].Properties["DashboardBody"]);
    for (const needle of [
      "CostMicroUsd",
      "FeedLatencyMs",
      "p95",
      "DeliveryFailures",
      "RecomputeFailures",
      "ApproximateNumberOfMessagesVisible",
      "HTTPCode_Target_5XX_Count",
      "OverBudget",
      // Per-user cost from the logs, no per-user metric (owner, 2026-10-26).
      'filter msg = \\\\\\"ai: call\\\\\\"',
      "by user_id",
    ]) {
      expect(body).toContain(needle);
    }
    // Every dead-letter queue is on it.
    const names = readdirSync(
      path.join(import.meta.dirname, "../../packages/db/messages"),
    )
      .filter((file) => file.endsWith(".schema.json"))
      .map((file) => file.replace(".schema.json", ""));
    for (const name of names) {
      expect(body).toContain(`${name}-dlq`);
    }
  });

  test("the 5xx rate alarms above 5% for two 5-minute periods", () => {
    const alarm = all("AWS::CloudWatch::Alarm").find(([, a]) =>
      JSON.stringify(a.Properties["Metrics"] ?? "").includes(
        "HTTPCode_Target_5XX_Count",
      ),
    );
    expect(alarm).toBeDefined();
    const metrics = JSON.stringify(alarm?.[1].Properties["Metrics"]);
    expect(metrics).toContain(
      "IF(requests >= 20, 100 * (FILL(errors, 0) + FILL(elb, 0)) / requests, 0)",
    );
    for (const name of [
      "HTTPCode_Target_5XX_Count",
      "HTTPCode_ELB_5XX_Count",
      "RequestCount",
    ]) {
      expect(metrics).toContain(name);
    }
    expect(metrics).toContain('"Stat":"Sum"');
    expect(metrics).toContain('"Period":300');
    expect(alarm?.[1].Properties).toMatchObject({
      Threshold: 5,
      EvaluationPeriods: 2,
      ComparisonOperator: "GreaterThanThreshold",
      TreatMissingData: "notBreaching",
    });
  });

  test("a budget breach alarms", () => {
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "OverBudget",
      Namespace: "Interval/AI",
      Statistic: "Sum",
      Threshold: 0,
      ComparisonOperator: "GreaterThanThreshold",
    });
  });

  test("alarms notify no one: the console only (owner, 2026-10-26)", () => {
    for (const [, alarm] of all("AWS::CloudWatch::Alarm")) {
      expect(alarm.Properties["AlarmActions"]).toBeUndefined();
    }
  });
});

describe("weekly question spot checks (P2-W8-S03, Q-2)", () => {
  test("EventBridge Scheduler runs spot-check-due weekly, with no queue access", () => {
    const schedule = scheduleFor("SpotCheckDueTask");
    expect(schedule.Properties["ScheduleExpression"]).toBe("rate(7 days)");
    expect(containerNamed("spot-check-due")?.Command).toEqual([
      "spot-check-due",
    ]);
    const actions = all("AWS::IAM::Policy")
      .filter(([, policy]) =>
        (policy.Properties["Roles"] as { Ref: string }[]).some((r) =>
          r.Ref.startsWith("SpotCheckDueTaskTaskRole"),
        ),
      )
      .flatMap(([, policy]) =>
        (
          policy.Properties["PolicyDocument"] as {
            Statement: { Action: string | string[] }[];
          }
        ).Statement.flatMap((st) => [st.Action].flat()),
      );
    expect(actions.some((a) => a.startsWith("sqs:"))).toBe(false);
  });
});
