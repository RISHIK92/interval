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

  test("Postgres accepts the app tasks only; Valkey those and the game server", () => {
    const app = groupId("Web, jobs and migrate tasks");
    // P3-W15-S03: the game server reads its matches from Valkey (Q-P3-22).
    const game = groupId("Game servers, reachable from the load balancer only");
    const ingress = all("AWS::EC2::SecurityGroupIngress").map(
      ([, r]) => r.Properties,
    );
    for (const [port, sources] of [
      [5432, [app]],
      [6379, [app, game]],
    ] as const) {
      const rules = ingress.filter((p) => p["FromPort"] === port);
      expect(
        rules
          .map(
            (r) =>
              (r["SourceSecurityGroupId"] as { "Fn::GetAtt": string[] })[
                "Fn::GetAtt"
              ][0],
          )
          .sort(),
      ).toEqual([...sources].sort());
      for (const rule of rules) expect(rule["CidrIp"]).toBeUndefined();
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
  // P4-W22-S04 (CACHE-4; owner, 2026-11-10): voiced explainers from their own bucket,
  // private but for CloudFront's origin access control; reads only, cached.
  test("/media/* comes from the media bucket through OAC, cached, reads only", () => {
    const [, dist] = only("AWS::CloudFront::Distribution");
    const config = dist.Properties["DistributionConfig"] as {
      CacheBehaviors: {
        PathPattern: string;
        CachePolicyId: string;
        TargetOriginId: string;
        AllowedMethods?: string[];
        ViewerProtocolPolicy: string;
      }[];
      Origins: {
        Id: string;
        S3OriginConfig?: unknown;
        OriginAccessControlId?: unknown;
      }[];
    };
    const mediaPath = config.CacheBehaviors.find(
      (b) => b.PathPattern === "/media/*",
    );
    expect(mediaPath?.CachePolicyId).toBe(
      "658327ea-f89d-4fab-a63d-7e88639e58f6",
    );
    expect(mediaPath?.ViewerProtocolPolicy).toBe("redirect-to-https");
    expect(mediaPath?.AllowedMethods ?? ["GET", "HEAD"]).toEqual([
      "GET",
      "HEAD",
    ]);
    const mediaOrigin = config.Origins.find(
      (o) => o.Id === mediaPath?.TargetOriginId,
    );
    expect(mediaOrigin?.S3OriginConfig).toBeDefined();
    expect(mediaOrigin?.OriginAccessControlId).toBeDefined();
    expect(all("AWS::CloudFront::OriginAccessControl")).toHaveLength(1);
    // Every bucket stays private: the media one only through OAC.
    for (const [, bucket] of all("AWS::S3::Bucket"))
      expect(bucket.Properties["PublicAccessBlockConfiguration"]).toEqual({
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      });
  });

  test("the media bucket lets only this distribution read it (OAC)", () => {
    const policies = all("AWS::S3::BucketPolicy").filter(([, p]) =>
      JSON.stringify(p.Properties["Bucket"]).includes("Media"),
    );
    expect(policies).toHaveLength(1);
    const statements = (
      policies[0]?.[1].Properties["PolicyDocument"] as {
        Statement: {
          Effect: string;
          Principal?: { Service?: string };
          Action: unknown;
          Condition?: unknown;
        }[];
      }
    ).Statement;
    const reads = statements.filter(
      (st) => st.Principal?.Service === "cloudfront.amazonaws.com",
    );
    expect(reads).toHaveLength(1);
    expect(reads[0]?.Effect).toBe("Allow");
    expect(reads[0]?.Action).toBe("s3:GetObject");
    expect(JSON.stringify(reads[0]?.Condition)).toContain("AWS:SourceArn");
    expect(JSON.stringify(reads[0]?.Condition)).toContain("Cdn");
  });

  test("the worker writes to the media bucket and nothing reads it but CloudFront", () => {
    const policies = Object.values(
      template.findResources("AWS::IAM::Policy"),
    ) as {
      Properties: {
        PolicyDocument: { Statement: { Action: unknown; Resource: unknown }[] };
        Roles: unknown[];
      };
    }[];
    const onMedia = policies.filter((p) =>
      p.Properties.PolicyDocument.Statement.some((st) =>
        JSON.stringify(st.Resource).includes("Media"),
      ),
    );
    expect(onMedia.map((p) => JSON.stringify(p.Properties.Roles))).toEqual([
      expect.stringContaining("WorkerTaskTaskRole"),
    ]);
    for (const policy of onMedia)
      for (const st of policy.Properties.PolicyDocument.Statement.filter((x) =>
        JSON.stringify(x.Resource).includes("Media"),
      ))
        expect(JSON.stringify(st.Action)).not.toContain("s3:GetObject");
    const env = (template.toJSON() as { Resources: Record<string, unknown> })
      .Resources;
    expect(JSON.stringify(env)).toContain('"MEDIA_BUCKET"');
  });

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
    // The web app's rule and the game server's (ADR-0033): both need the header.
    const rules = all("AWS::ElasticLoadBalancingV2::ListenerRule");
    expect(rules).toHaveLength(2);
    for (const [, rule] of rules) {
      expect(JSON.stringify(rule.Properties["Conditions"])).toContain(
        "X-Origin-Verify",
      );
      expect(JSON.stringify(rule.Properties["Conditions"])).toContain(
        "resolve:secretsmanager",
      );
    }
  });
});

// P3-W15-S01 (ADR-0033, LOAD-2): game server 0 behind the ALB at /game/0/*.
describe("game server (ADR-0033)", () => {
  const container = () =>
    all("AWS::ECS::TaskDefinition")
      .flatMap(
        ([, task]) =>
          task.Properties["ContainerDefinitions"] as {
            Name: string;
            Environment?: { Name: string; Value?: unknown }[];
            Secrets?: unknown[];
            PortMappings?: { ContainerPort: number }[];
          }[],
      )
      .find((c) => c.Name === "game");

  const gameService = () => {
    const found = all("AWS::ECS::Service").find(([, r]) =>
      JSON.stringify(r.Properties).includes("Game0Task"),
    );
    if (found === undefined) throw new Error("no game service");
    return found;
  };

  test("one ARM64 task runs server 0 on port 8080, with the ticket secret only", () => {
    const game = container();
    expect(game?.Environment?.map((e) => e.Name).sort()).toEqual([
      "GAME_SERVER_ID",
      "VALKEY_URL",
    ]);
    expect(
      game?.Environment?.find((e) => e.Name === "GAME_SERVER_ID")?.Value,
    ).toBe("0");
    // P3-W15-S02: it checks match tickets; it reads nothing else, least of all the database.
    expect(
      (game?.Secrets as { Name: string }[] | undefined)?.map((s) => s.Name),
    ).toEqual(["GAME_TICKET_SECRET"]);
    expect(game?.PortMappings).toEqual([
      expect.objectContaining({ ContainerPort: 8080 }),
    ]);
    // Never two at once (a match's socket must reach its owner): a deploy stops the
    // old task before starting the new one.
    const [, service] = gameService();
    expect(service.Properties["DesiredCount"]).toBe(1);
    expect(service.Properties["DeploymentConfiguration"]).toMatchObject({
      MinimumHealthyPercent: 0,
      MaximumPercent: 100,
      DeploymentCircuitBreaker: { Enable: true, Rollback: true },
    });
  });

  test("the ALB sends /game/0/* with the CloudFront header to it, before the web app", () => {
    const rules = all("AWS::ElasticLoadBalancingV2::ListenerRule").map(
      ([, r]) => r.Properties,
    );
    const game = rules.find((r) =>
      JSON.stringify(r["Conditions"]).includes("/game/0/*"),
    );
    const web = rules.find((r) => r !== game);
    expect(game).toBeDefined();
    expect(Number(game?.["Priority"])).toBeLessThan(Number(web?.["Priority"]));
    template.hasResourceProperties("AWS::ElasticLoadBalancingV2::TargetGroup", {
      Port: 8080,
      HealthCheckPath: "/healthz",
      Matcher: { HttpCode: "200" },
      // Nothing to drain: the old task is stopping and its players reconnect.
      TargetGroupAttributes: Match.arrayWith([
        { Key: "deregistration_delay.timeout_seconds", Value: "5" },
      ]),
    });
  });

  // P3-W17-S05b (LOAD-5): agent nudges not queued, and pushes that failed, counted.
  test.each([
    ["agent: nudge not queued", "NudgeNotQueued"],
    ["agent: push failed", "PushFailures"],
  ])("%s becomes a CloudWatch metric", (msg, metric) => {
    template.hasResourceProperties("AWS::Logs::MetricFilter", {
      FilterPattern: `{ $.msg = "${msg}" }`,
      MetricTransformations: [
        Match.objectLike({
          MetricNamespace: "Interval/Agent",
          MetricName: metric,
        }),
      ],
    });
  });

  // P3-W15-S05 (LOAD-5): a result the game server couldn't hand over, counted.
  test("a result not handed over becomes a CloudWatch metric", () => {
    template.hasResourceProperties("AWS::Logs::MetricFilter", {
      FilterPattern: '{ $.msg = "game: result not handed over" }',
      MetricTransformations: [
        Match.objectLike({
          MetricNamespace: "Interval/Game",
          MetricName: "ResultHandoffFailures",
        }),
      ],
    });
  });

  // P3-W15-S05 (LOAD-5): a result the worker couldn't record, and evidence that
  // didn't apply, counted.
  test("a lost match result and unapplied match evidence become metrics", () => {
    template.hasResourceProperties("AWS::Logs::MetricFilter", {
      FilterPattern:
        '{ ($.msg = "game: result missing") || ($.msg = "game: result refused") }',
      MetricTransformations: [
        Match.objectLike({
          MetricNamespace: "Interval/Game",
          MetricName: "ResultsLost",
        }),
      ],
    });
    template.hasResourceProperties("AWS::Logs::MetricFilter", {
      FilterPattern: '{ $.msg = "game: match evidence not applied" }',
      MetricTransformations: [
        Match.objectLike({
          MetricNamespace: "Interval/Game",
          MetricName: "EvidenceFailures",
        }),
      ],
    });
  });

  // P3-W16-S02 (LOAD-5): a pair whose match couldn't be made waits on, counted.
  test("a match matchmaking couldn't make becomes a metric", () => {
    template.hasResourceProperties("AWS::Logs::MetricFilter", {
      FilterPattern: '{ $.msg = "game: match not made" }',
      MetricTransformations: [
        Match.objectLike({
          MetricNamespace: "Interval/Game",
          MetricName: "MatchesNotMade",
        }),
      ],
    });
  });

  // P3-W15-S04 (LOAD-5): a match plays on without its snapshot, counted.
  test("a failed match snapshot becomes a CloudWatch metric", () => {
    template.hasResourceProperties("AWS::Logs::MetricFilter", {
      FilterPattern: '{ $.msg = "game: snapshot failed" }',
      MetricTransformations: [
        Match.objectLike({
          MetricNamespace: "Interval/Game",
          MetricName: "SnapshotFailures",
        }),
      ],
    });
  });

  test("the ALB keeps idle match sockets for 120 seconds", () => {
    template.hasResourceProperties(
      "AWS::ElasticLoadBalancingV2::LoadBalancer",
      {
        LoadBalancerAttributes: Match.arrayWith([
          { Key: "idle_timeout.timeout_seconds", Value: "120" },
        ]),
      },
    );
  });

  test("CloudFront passes /game/* through uncached, with the handshake but no cookies", () => {
    const [, dist] = only("AWS::CloudFront::Distribution");
    const behaviors = (
      dist.Properties["DistributionConfig"] as {
        CacheBehaviors: {
          PathPattern: string;
          CachePolicyId: string;
          OriginRequestPolicyId?: unknown;
        }[];
      }
    ).CacheBehaviors;
    const game = behaviors.find((b) => b.PathPattern === "/game/*");
    // AWS managed policy id: CachingDisabled.
    expect(game?.CachePolicyId).toBe("4135ea2d-6df8-44a3-9df3-4b5a84be39ad");
    const [id, policy] = only("AWS::CloudFront::OriginRequestPolicy");
    expect(game?.OriginRequestPolicyId).toEqual({ Ref: id });
    expect(policy.Properties["OriginRequestPolicyConfig"]).toMatchObject({
      CookiesConfig: { CookieBehavior: "none" },
      QueryStringsConfig: { QueryStringBehavior: "all" },
      HeadersConfig: {
        HeaderBehavior: "whitelist",
        Headers: expect.arrayContaining([
          "Sec-WebSocket-Key",
          "Sec-WebSocket-Version",
          "Origin",
        ]) as unknown,
      },
    });
  });

  test("only the ALB reaches the game server, which reaches Valkey but not Postgres", () => {
    const game = groupId("Game servers, reachable from the load balancer only");
    const ingress = all("AWS::EC2::SecurityGroupIngress").map(([, r]) =>
      JSON.stringify(r.Properties),
    );
    // Into the game group: 8080, from the ALB, and nothing else.
    const into = ingress.filter((r) =>
      r.includes(`"GroupId":{"Fn::GetAtt":["${game}"`),
    );
    expect(into).toHaveLength(1);
    expect(into[0]).toContain('"FromPort":8080');
    expect(into[0]).toContain(
      groupId("Public load balancer behind CloudFront"),
    );
    // P3-W15-S03: into Valkey (6379), where the web app leaves each match; never into
    // Postgres.
    const out = ingress.filter((r) =>
      r.includes(`"SourceSecurityGroupId":{"Fn::GetAtt":["${game}"`),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('"FromPort":6379');
    expect(out[0]).toContain('"ToPort":6379');
    expect(JSON.stringify(gameService()[1].Properties)).toContain(game);
  });
});

describe("containers", () => {
  test("ARM64 tasks get secrets only through ECS secrets, never plain env", () => {
    const tasks = all("AWS::ECS::TaskDefinition");
    // web, jobs, worker, migrate, poll-due, recompute-due, check-links-due,
    // spot-check-due, question-batches, recalibrate-difficulty, sync-github-due,
    // suggest-technologies, daily-challenge-due, game-0 (ADR-0033), close-season,
    // push-due (P4-W24-S01b)
    expect(tasks.length).toBe(16);
    for (const [, task] of tasks) {
      expect(task.Properties["RuntimePlatform"]).toMatchObject({
        CpuArchitecture: "ARM64",
      });
      const containers = task.Properties["ContainerDefinitions"] as {
        Name: string;
        Environment?: { Name: string }[];
        Secrets?: { Name: string }[];
      }[];
      for (const c of containers) {
        // The OCR sidecar (ADR-0022) reads page images only: no secrets, no env.
        if (c.Name === "ocr") {
          expect(c.Secrets).toBeUndefined();
          expect(c.Environment).toBeUndefined();
          continue;
        }
        // The game server (ADR-0033) never reads the database: the ticket secret only.
        if (c.Name === "game") {
          expect((c.Secrets ?? []).map((s) => s.Name)).toEqual([
            "GAME_TICKET_SECRET",
          ]);
          continue;
        }
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
            Environment?: { Name: string; Value?: unknown }[];
            Secrets?: { Name: string }[];
          }[],
      )
      .find((c) => c.Name === "web");
    expect((web?.Environment ?? []).map((e) => e.Name)).toContain(
      "BETTER_AUTH_URL",
    );
    // P3-W13-S07: CloudFront and the ALB each add to X-Forwarded-For, so the visitor
    // is the second from the right (apps/web/src/server/clientIp.ts).
    expect(
      (web?.Environment ?? []).find((e) => e.Name === "TRUSTED_PROXIES")?.Value,
    ).toBe("2");
    expect((web?.Secrets ?? []).map((s) => s.Name)).toContain(
      "BETTER_AUTH_SECRET",
    );
    // P3-W15-S02 (ADR-0033): it signs match tickets.
    expect((web?.Secrets ?? []).map((s) => s.Name)).toContain(
      "GAME_TICKET_SECRET",
    );
    // P2-W12-S01 (ADR-0024): the GitHub App's, for the web app only.
    expect((web?.Secrets ?? []).map((s) => s.Name)).toEqual(
      expect.arrayContaining([
        "GITHUB_APP_SLUG",
        "GITHUB_APP_CLIENT_ID",
        "GITHUB_APP_CLIENT_SECRET",
      ]),
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

  test("every task that uses the database connects to RDS with verified TLS", () => {
    for (const [, task] of all("AWS::ECS::TaskDefinition")) {
      const text = JSON.stringify(task.Properties["ContainerDefinitions"]);
      // ADR-0033: Go never reads the database.
      if (text.includes('"Name":"game"')) continue;
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
    // Each schedule's role may run its own task only (eleven schedules, push-due the
    // eleventh, P4-W24-S01b).
    const runTask = all("AWS::IAM::Policy").flatMap(([, policy]) =>
      (
        policy.Properties["PolicyDocument"] as {
          Statement: { Action: string | string[]; Resource: unknown }[];
        }
      ).Statement.filter((st) => [st.Action].flat().includes("ecs:RunTask")),
    );
    expect(runTask).toHaveLength(11);
    const targets = runTask.map((st) => JSON.stringify(st.Resource));
    expect(targets.filter((t) => t.includes("PollDueTask"))).toHaveLength(1);
    expect(targets.filter((t) => t.includes("PushDueTask"))).toHaveLength(1);
    expect(targets.filter((t) => t.includes("RecomputeDueTask"))).toHaveLength(
      1,
    );
    expect(targets.filter((t) => t.includes("CheckLinksDueTask"))).toHaveLength(
      1,
    );
    expect(targets.filter((t) => t.includes("SpotCheckDueTask"))).toHaveLength(
      1,
    );
    expect(targets.filter((t) => t.includes("SyncGitHubDueTask"))).toHaveLength(
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
          Environment?: { Name: string; Value: unknown }[];
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
    // Only the recompute_feed queue: least privilege.
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
    expect(resources).not.toContain("polishnote");
    expect(sends.flatMap((st) => [st.Resource].flat())).toHaveLength(1);
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

describe("weekly technology suggestions (P2-W12-S03, PER-4)", () => {
  test("suggest-technologies runs weekly with only the DB and model secrets", () => {
    const schedule = scheduleFor("SuggestTechnologiesTask");
    expect(schedule.Properties["ScheduleExpression"]).toBe("rate(7 days)");
    expect(
      (containerNamed("suggest-technologies")?.Secrets ?? []).map(
        (x) => x.Name,
      ),
    ).toEqual(["DB_PASSWORD", "OPENROUTER_API_KEY"]);
  });
});

describe("daily GitHub reads (P2-W12-S02, Q-P2-40)", () => {
  test("sync-github-due runs daily, sending only to github_sync with only the DB secret", () => {
    const schedule = scheduleFor("SyncGitHubDueTask");
    expect(schedule.Properties["ScheduleExpression"]).toBe("rate(1 day)");
    expect(containerNamed("sync-github-due")?.Command).toEqual([
      "sync-github-due",
    ]);
    expect(
      (containerNamed("sync-github-due")?.Secrets ?? []).map((x) => x.Name),
    ).toEqual(["DB_PASSWORD"]);
    const sends = all("AWS::IAM::Policy")
      .filter(([, policy]) =>
        (policy.Properties["Roles"] as { Ref: string }[]).some((r) =>
          r.Ref.startsWith("SyncGitHubDueTaskTaskRole"),
        ),
      )
      .flatMap(
        ([, policy]) =>
          (
            policy.Properties["PolicyDocument"] as {
              Statement: { Action: string | string[]; Resource: unknown }[];
            }
          ).Statement,
      );
    expect(JSON.stringify(sends.map((st) => st.Resource))).toContain(
      "githubsync",
    );
  });

  test("the worker gets the App's id and key; the web app doesn't", () => {
    const names = (name: string) =>
      (containerNamed(name)?.Secrets ?? []).map((x) => x.Name);
    expect(names("worker")).toEqual(
      expect.arrayContaining(["GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY"]),
    );
    expect(names("web")).not.toContain("GITHUB_APP_PRIVATE_KEY");
  });

  // P4-W19-S04b: native push's keys go to the worker, which sends; never to the web.
  test("the worker gets the APNs and FCM keys; the web app doesn't", () => {
    const names = (name: string) =>
      (containerNamed(name)?.Secrets ?? []).map((x) => x.Name);
    const push = [
      "APNS_KEY",
      "APNS_KEY_ID",
      "APNS_TEAM_ID",
      "FCM_SERVICE_ACCOUNT",
    ];
    expect(names("worker")).toEqual(expect.arrayContaining(push));
    for (const name of push) expect(names("web")).not.toContain(name);
  });
});

describe("Athena metric queries (W6-S04, DB-5)", () => {
  const QUERIES = path.join(
    import.meta.dirname,
    "../../packages/events/queries",
  );
  const PROPS =
    "struct<kind:string,item_id:string,moment_id:string,method:string,question_id:string,path_id:string,section_id:string,passed:boolean,game:string,wait_ms:bigint,opponent:string,explainer_id:string,on:boolean>";
  // Phase 1 (Q-P1-21) and Phase 2 (P2-W9-S08, Q-P2-20) "done when".
  const FILES = [
    "return_rate.sql",
    "finished_rate.sql",
    "quiz_rate.sql",
    "flag_rate.sql",
    "quiz_return.sql",
    "path_progress.sql",
    // Phase 3 (P3-W18-S03).
    "daily_share.sql",
    "match_start.sql",
    "player_return.sql",
    "missed_read.sql",
    // Phase 4 (P4-W24-S02).
    "native_retention.sql",
    "listen_share.sql",
    "explainer_completion.sql",
    "push_opt_in.sql",
  ];

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
      [...PROPS.matchAll(/(\w+):\w+/g)].map((m) => m[1]),
    );
    for (const file of FILES) {
      const sql = readFileSync(path.join(QUERIES, file), "utf8");
      // A reserved word ("on") is read quoted: props."on".
      for (const [, prop] of sql.matchAll(/props\."?(\w+)"?/g)) {
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

  test("every metric is a saved query carrying the repo's SQL", () => {
    const saved = all("AWS::Athena::NamedQuery").map(
      ([, q]) =>
        q.Properties as {
          QueryString: string;
          Database: string;
          WorkGroup: string;
        },
    );
    expect(saved).toHaveLength(FILES.length);
    for (const file of FILES) {
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

describe("weekly difficulty recalibration (P2-W9-S08, Q-3)", () => {
  test("EventBridge Scheduler runs recalibrate-difficulty weekly, with only the database", () => {
    const schedule = scheduleFor("RecalibrateDifficultyTask");
    expect(schedule.Properties["ScheduleExpression"]).toBe("rate(7 days)");
    const container = containerNamed("recalibrate-difficulty");
    expect(container?.Command).toEqual(["recalibrate-difficulty"]);
    expect((container?.Secrets ?? []).map((s) => s.Name)).toEqual([
      "DB_PASSWORD",
    ]);
    const actions = all("AWS::IAM::Policy")
      .filter(([, policy]) =>
        (policy.Properties["Roles"] as { Ref: string }[]).some((r) =>
          r.Ref.startsWith("RecalibrateDifficultyTaskTaskRole"),
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

describe("the daily challenge (P3-W13-S05, ADR-0031)", () => {
  // P4-W24-S01b (Q-P4-13): the opt-in pushes, hourly, with the push secrets; one that
  // reaches nobody is counted.
  test("EventBridge Scheduler runs push-due hourly with the push secrets, with no queue access", () => {
    template.hasResourceProperties("AWS::Logs::MetricFilter", {
      FilterPattern: '{ $.msg = "push: not delivered" }',
      MetricTransformations: [
        Match.objectLike({
          MetricNamespace: "Interval/Push",
          MetricName: "NotDelivered",
        }),
      ],
    });
    const schedule = scheduleFor("PushDueTask");
    expect(schedule.Properties["ScheduleExpression"]).toBe("cron(0 * * * ? *)");
    const container = containerNamed("push-due");
    expect(container?.Command).toEqual(["push-due"]);
    expect((container?.Secrets ?? []).map((x) => x.Name).sort()).toEqual([
      "APNS_KEY",
      "APNS_KEY_ID",
      "APNS_TEAM_ID",
      "DB_PASSWORD",
      "FCM_SERVICE_ACCOUNT",
      "VAPID_PRIVATE_KEY",
    ]);
    expect(
      (container?.Environment ?? []).some((e) => e.Name === "VAPID_SUBJECT"),
    ).toBe(true);
    const actions = all("AWS::IAM::Policy")
      .filter(([, policy]) =>
        (policy.Properties["Roles"] as { Ref: string }[]).some((r) =>
          r.Ref.startsWith("PushDueTaskTaskRole"),
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

  test("EventBridge Scheduler runs daily-challenge-due at 00:00 UTC, with no queue access", () => {
    const schedule = scheduleFor("DailyChallengeDueTask");
    expect(schedule.Properties["ScheduleExpression"]).toBe("cron(0 0 * * ? *)");
    expect(schedule.Properties["ScheduleExpressionTimezone"]).toBe("Etc/UTC");
    template.hasResourceProperties("AWS::Logs::MetricFilter", {
      FilterPattern: '{ $.msg = "daily: published unreviewed" }',
      MetricTransformations: [
        Match.objectLike({
          MetricNamespace: "Interval/Daily",
          MetricName: "PublishedUnreviewed",
          MetricValue: "1",
        }),
      ],
    });
    expect(containerNamed("daily-challenge-due")?.Command).toEqual([
      "daily-challenge-due",
    ]);
    const actions = all("AWS::IAM::Policy")
      .filter(([, policy]) =>
        (policy.Properties["Roles"] as { Ref: string }[]).some((r) =>
          r.Ref.startsWith("DailyChallengeDueTaskTaskRole"),
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

describe("monthly seasons (P3-W16-S06, Q-P3-13)", () => {
  test("EventBridge Scheduler runs close-season daily at 00:00 UTC (a failed 1st retried the next day), with only the DB secret and no queue", () => {
    const schedule = scheduleFor("CloseSeasonTask");
    expect(schedule.Properties["ScheduleExpression"]).toBe("cron(0 0 * * ? *)");
    expect(schedule.Properties["ScheduleExpressionTimezone"]).toBe("Etc/UTC");
    expect(containerNamed("close-season")?.Command).toEqual(["close-season"]);
    expect(
      (containerNamed("close-season")?.Secrets ?? []).map((x) => x.Name),
    ).toEqual(["DB_PASSWORD"]);
    const actions = all("AWS::IAM::Policy")
      .filter(([, policy]) =>
        (policy.Properties["Roles"] as { Ref: string }[]).some((r) =>
          r.Ref.startsWith("CloseSeasonTaskTaskRole"),
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

describe("question batches (P2-W8-S05, Q-P2-13)", () => {
  test("EventBridge Scheduler runs question-batches every 30 minutes, with no queue access", () => {
    const schedule = scheduleFor("QuestionBatchesTask");
    expect(schedule.Properties["ScheduleExpression"]).toBe("rate(30 minutes)");
    const container = containerNamed("question-batches");
    expect(container?.Command).toEqual(["question-batches"]);
    expect(
      (container?.Secrets ?? []).map((s: { Name: string }) => s.Name).sort(),
    ).toEqual(["DB_PASSWORD", "OPENROUTER_API_KEY"]);
    const actions = all("AWS::IAM::Policy")
      .filter(([, policy]) =>
        (policy.Properties["Roles"] as { Ref: string }[]).some((r) =>
          r.Ref.startsWith("QuestionBatchesTaskTaskRole"),
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

describe("PDF books (P2-W11-S01)", () => {
  test("only the web app and the worker delete, only books, only as a marker", () => {
    const policies = Object.values(
      template.findResources("AWS::IAM::Policy"),
    ) as {
      Properties: {
        PolicyDocument: { Statement: { Action: unknown; Resource: unknown }[] };
        Roles: unknown[];
      };
    }[];
    const deleting = policies.filter((p) =>
      p.Properties.PolicyDocument.Statement.some((st) =>
        JSON.stringify(st.Action).includes("s3:Delete"),
      ),
    );
    // The web task's role (its undo), and the jobs and worker tasks' (remove_file).
    expect(
      deleting.map((p) => JSON.stringify(p.Properties.Roles)).sort(),
    ).toEqual([
      expect.stringContaining("JobsTaskTaskRole"),
      expect.stringContaining("WebTaskTaskRole"),
      expect.stringContaining("WorkerTaskTaskRole"),
    ]);
    for (const policy of deleting)
      for (const st of policy.Properties.PolicyDocument.Statement.filter((x) =>
        JSON.stringify(x.Action).includes("s3:Delete"),
      )) {
        expect(st.Action).toBe("s3:DeleteObject");
        expect(JSON.stringify(st.Resource)).toMatch(/\/books\/\*"\]\]\}$/);
      }
  });

  test("a leaderboard write or invalidation that failed is counted (LOAD-5)", () => {
    for (const [msg, name] of [
      ["boards: write failed", "WriteFailures"],
      ["boards: invalidation failed", "InvalidationFailures"],
    ] as const)
      template.hasResourceProperties("AWS::Logs::MetricFilter", {
        FilterPattern: `{ $.msg = "${msg}" }`,
        MetricTransformations: [
          Match.objectLike({
            MetricNamespace: "Interval/Boards",
            MetricName: name,
          }),
        ],
      });
  });

  test("a book file left behind is counted", () => {
    template.hasResourceProperties("AWS::Logs::MetricFilter", {
      FilterPattern: '{ $.msg = "books: file not removed" }',
      MetricTransformations: [
        Match.objectLike({
          MetricNamespace: "Interval/Books",
          MetricName: "FilesNotRemoved",
        }),
      ],
    });
  });
});

describe("OCR (ADR-0022, P2-W11-S03)", () => {
  test("Tesseract runs beside the consumer, capped at 512 MB, which calls it locally", () => {
    template.hasResourceProperties("AWS::ECS::TaskDefinition", {
      Memory: "2048",
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Name: "worker",
          Environment: Match.arrayWith([
            { Name: "OCR_URL", Value: "http://localhost:8080" },
          ]),
        }),
        // ADR-0023: a crashed OCR container holds up scanned pages only.
        Match.objectLike({ Name: "ocr", Memory: 512, Essential: false }),
      ]),
    });
  });

  test("the consumer reads private files (book_process, ocr_page)", () => {
    const policies = Object.values(
      template.findResources("AWS::IAM::Policy"),
    ) as { Properties: { Roles: unknown[]; PolicyDocument: unknown } }[];
    const worker = policies.filter((p) =>
      JSON.stringify(p.Properties.Roles).includes("WorkerTaskTaskRole"),
    );
    const statements = worker.flatMap(
      (p) =>
        (
          p.Properties.PolicyDocument as {
            Statement: { Action: unknown; Resource: unknown }[];
          }
        ).Statement,
    );
    const reads = statements.filter((st) =>
      JSON.stringify(st.Action).includes("s3:GetObject"),
    );
    expect(reads.length).toBeGreaterThan(0);
    for (const st of reads)
      expect(JSON.stringify(st.Resource)).toContain("PrivateContent");
  });
});

test("a page OCR gave up on is counted (P2-W11-S03)", () => {
  template.hasResourceProperties("AWS::Logs::MetricFilter", {
    FilterPattern: '{ $.msg = "books: ocr gave up" }',
    MetricTransformations: [
      Match.objectLike({
        MetricNamespace: "Interval/Books",
        MetricName: "OcrGaveUp",
      }),
    ],
  });
});

describe("web push (P3-W17-S05b, Q-P3-18)", () => {
  test("the web app has only the public VAPID key; the worker signs, with the site as its contact", () => {
    const secretsOf = (name: string) =>
      (containerNamed(name)?.Secrets ?? []).map((x) => x.Name);
    expect(secretsOf("web")).toContain("VAPID_PUBLIC_KEY");
    expect(secretsOf("web")).not.toContain("VAPID_PRIVATE_KEY");
    expect(secretsOf("worker")).toContain("VAPID_PRIVATE_KEY");
    const subject = (containerNamed("worker")?.Environment ?? []).find(
      (e) => e.Name === "VAPID_SUBJECT",
    );
    expect(JSON.stringify(subject?.Value)).toContain("https://");
  });
});
