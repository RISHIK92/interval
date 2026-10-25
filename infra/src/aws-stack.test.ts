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

describe("queues", () => {
  test("ingest and feed redrive to DLQs after 5 receives, and DLQ depth alarms", () => {
    const withRedrive = all("AWS::SQS::Queue").filter(
      ([, q]) => q.Properties["RedrivePolicy"],
    );
    expect(withRedrive).toHaveLength(2);
    for (const [, queue] of withRedrive) {
      expect(queue.Properties["RedrivePolicy"]).toMatchObject({
        maxReceiveCount: 5,
      });
      expect(queue.Properties["SqsManagedSseEnabled"]).toBe(true);
    }
    template.resourceCountIs("AWS::SQS::Queue", 4);
    const alarms = all("AWS::CloudWatch::Alarm").filter(
      ([, a]) =>
        a.Properties["MetricName"] === "ApproximateNumberOfMessagesVisible",
    );
    expect(alarms).toHaveLength(2);
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
    expect(tasks.length).toBe(3); // web, jobs, migrate
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
