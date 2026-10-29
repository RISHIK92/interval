import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, expect, test } from "vitest";
import { DATA_MOUNT, ProdStack } from "./prod-stack.ts";
import {
  expectEventStream,
  firehoseActionsFor,
} from "./events-stream.test-helpers.ts";

let template: Template;
let json: string;

beforeAll(() => {
  const app = new App();
  const stack = new ProdStack(app, "interval-prod", {
    env: { region: "ap-south-1" },
  });
  template = Template.fromStack(stack);
  json = JSON.stringify(template.toJSON());
});

describe("network", () => {
  test("public subnets only, no NAT gateway", () => {
    template.resourceCountIs("AWS::EC2::NatGateway", 0);
    const subnets = template.findResources("AWS::EC2::Subnet");
    for (const subnet of Object.values(subnets)) {
      expect(subnet["Properties"]).toMatchObject({ MapPublicIpOnLaunch: true });
    }
  });

  test("only 80 and 443 are open, and nothing else", () => {
    const groups = template.findResources("AWS::EC2::SecurityGroup");
    const ingress = Object.values(groups).flatMap(
      (g) =>
        (
          g["Properties"] as {
            SecurityGroupIngress?: { FromPort: number; ToPort: number }[];
          }
        ).SecurityGroupIngress ?? [],
    );
    expect(
      new Set(ingress.map((r) => `${String(r.FromPort)}-${String(r.ToPort)}`)),
    ).toEqual(new Set(["80-80", "443-443"]));
    template.resourceCountIs("AWS::EC2::SecurityGroupIngress", 0);
  });
});

describe("instance", () => {
  test("t4g.medium, IMDSv2, encrypted root, no key pair", () => {
    template.hasResourceProperties("AWS::EC2::Instance", {
      InstanceType: "t4g.medium",
      KeyName: Match.absent(),
      BlockDeviceMappings: Match.arrayWith([
        Match.objectLike({
          Ebs: Match.objectLike({ Encrypted: true, VolumeType: "gp3" }),
        }),
      ]),
    });
    // IMDSv2 only. Hop limit 2: the containers reach the instance role (Firehose, S3)
    // through Docker's bridge network, one hop further than the host.
    template.hasResourceProperties("AWS::EC2::Instance", {
      MetadataOptions: {
        HttpEndpoint: "enabled",
        HttpTokens: "required",
        HttpPutResponseHopLimit: 2,
      },
    });
  });

  test("role allows SSM Session Manager", () => {
    template.hasResourceProperties("AWS::IAM::Role", {
      ManagedPolicyArns: Match.arrayWith([
        Match.objectLike({
          "Fn::Join": Match.arrayWith([
            Match.arrayWith([
              Match.stringLikeRegexp("AmazonSSMManagedInstanceCore"),
            ]),
          ]),
        }),
      ]),
    });
  });

  test("has an Elastic IP", () => {
    template.resourceCountIs("AWS::EC2::EIP", 1);
  });
});

describe("data volume", () => {
  test("30 GB gp3, encrypted, retained and attached", () => {
    template.hasResource("AWS::EC2::Volume", {
      Properties: { Size: 30, VolumeType: "gp3", Encrypted: true },
      DeletionPolicy: "Retain",
      UpdateReplacePolicy: "Retain",
    });
    template.resourceCountIs("AWS::EC2::VolumeAttachment", 1);
  });
});

describe("buckets", () => {
  test("two buckets: private, encrypted, retained", () => {
    const buckets = template.findResources("AWS::S3::Bucket");
    expect(Object.keys(buckets)).toHaveLength(2);
    for (const bucket of Object.values(buckets)) {
      expect(bucket).toMatchObject({
        DeletionPolicy: "Retain",
        Properties: {
          PublicAccessBlockConfiguration: {
            BlockPublicAcls: true,
            BlockPublicPolicy: true,
            IgnorePublicAcls: true,
            RestrictPublicBuckets: true,
          },
          BucketEncryption: {
            ServerSideEncryptionConfiguration: [
              { ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } },
            ],
          },
        },
      });
    }
  });

  test("both buckets deny non-TLS requests", () => {
    const policies = template.findResources("AWS::S3::BucketPolicy", {
      Properties: {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: "Deny",
              Condition: { Bool: { "aws:SecureTransport": "false" } },
            }),
          ]),
        },
      },
    });
    expect(Object.keys(policies)).toHaveLength(2);
  });
});

describe("secrets", () => {
  test("seven generated secrets, retained", () => {
    const secrets = template.findResources("AWS::SecretsManager::Secret");
    const names = Object.values(secrets).map(
      (s) => (s["Properties"] as { Name: string }).Name,
    );
    expect(new Set(names)).toEqual(
      new Set([
        "interval/prod/postgres",
        "interval/prod/better-auth",
        "interval/prod/openrouter",
        "interval/prod/voyage",
        "interval/prod/github-app-slug",
        "interval/prod/github-app-client-id",
        "interval/prod/github-app-client-secret",
      ]),
    );
    for (const secret of Object.values(secrets)) {
      expect(secret).toMatchObject({
        DeletionPolicy: "Retain",
        Properties: { GenerateSecretString: expect.any(Object) as unknown },
      });
      expect(secret["Properties"]).not.toHaveProperty("SecretString");
    }
  });

  test("no secret value or plain credential appears in the template", () => {
    expect(json).not.toMatch(/"SecretString"/);
    expect(json).not.toMatch(
      /POSTGRES_PASSWORD|OPENROUTER_API_KEY|VOYAGE_API_KEY/,
    );
  });
});

test("no managed database or container services", () => {
  for (const type of [
    "AWS::RDS::DBInstance",
    "AWS::RDS::DBCluster",
    "AWS::ECS::Cluster",
  ]) {
    template.resourceCountIs(type, 0);
  }
});

type Resource = {
  Properties: Record<string, unknown>;
  DeletionPolicy?: string;
};

function only(type: string): [string, Resource] {
  const found = Object.entries(template.findResources(type)) as [
    string,
    Resource,
  ][];
  expect(found).toHaveLength(1);
  const first = found[0];
  if (first === undefined) throw new Error(`no ${type}`);
  return first;
}

function userDataScript(): string {
  return JSON.stringify(template.findResources("AWS::EC2::Instance"));
}

describe("replacement safety", () => {
  test("the AMI is a pinned id, never resolved at deploy time", () => {
    const [, vm] = only("AWS::EC2::Instance");
    expect(vm.Properties["ImageId"]).toMatch(/^ami-[0-9a-f]{17}$/);
    expect(json).not.toContain("/aws/service/ami-amazon-linux-latest");
  });

  test("the data volume is in the VM's subnet AZ and attached to that VM", () => {
    const [vmId, vm] = only("AWS::EC2::Instance");
    const [volumeId, volume] = only("AWS::EC2::Volume");
    const subnetRef = (vm.Properties["SubnetId"] as { Ref: string }).Ref;
    const subnet = template.findResources("AWS::EC2::Subnet")[
      subnetRef
    ] as Resource;
    expect(volume.Properties["AvailabilityZone"]).toEqual(
      subnet.Properties["AvailabilityZone"],
    );
    template.hasResourceProperties("AWS::EC2::VolumeAttachment", {
      InstanceId: { Ref: vmId },
      VolumeId: { Ref: volumeId },
    });
  });

  test("the Elastic IP is retained and associated with the VM", () => {
    const [vmId] = only("AWS::EC2::Instance");
    const [, eip] = only("AWS::EC2::EIP");
    expect(eip.DeletionPolicy).toBe("Retain");
    template.hasResourceProperties("AWS::EC2::EIPAssociation", {
      InstanceId: { Ref: vmId },
    });
  });

  test("the deploy waits for the VM's success signal", () => {
    template.hasResource("AWS::EC2::Instance", {
      CreationPolicy: { ResourceSignal: { Count: 1, Timeout: "PT15M" } },
    });
    expect(userDataScript()).toContain("cfn-signal");
  });
});

describe("user data", () => {
  test("fails fast, verifies the compose download and never force-formats", () => {
    const script = userDataScript();
    expect(script).toContain("set -euo pipefail");
    expect(script).toContain("sha256sum --check");
    expect(script).toContain('blkid -p \\"$DEV\\" || rc=$?');
    expect(script).toMatch(/rc\\" -eq 2 \]; then mkfs -t xfs/);
    expect(script).not.toMatch(/mkfs[^;]*-f\b/);
  });

  test("installs git and a checksummed buildx, which the deploy needs", () => {
    const script = userDataScript();
    expect(script).toContain("dnf install -y docker git");
    expect(script).toMatch(/docker-buildx[^;]*sha256sum --check/);
  });

  test("Docker only starts with the data volume mounted", () => {
    const script = userDataScript();
    expect(script).toContain(`RequiresMountsFor=${DATA_MOUNT}`);
    expect(script).toContain(`mountpoint -q ${DATA_MOUNT}`);
    expect(script).toContain("nofail");
  });
});

describe("permissions", () => {
  test("the VM reads and adds private files, and deletes only books, as a marker", () => {
    const policies = JSON.stringify(template.findResources("AWS::IAM::Policy"));
    // Old versions stay recoverable: never a version delete, never outside books/.
    expect(policies).not.toMatch(/s3:DeleteObjectVersion/);
    expect(policies).toMatch(/"s3:DeleteObject"/);
    expect(policies).toMatch(/books\/\*/);
    expect(policies).toMatch(/s3:PutObject/);
    expect(policies).toMatch(/s3:GetObject/);
  });

  test("no S3 permission on every resource", () => {
    const policies = template.findResources("AWS::IAM::Policy");
    for (const policy of Object.values(policies)) {
      const statements = (
        policy["Properties"] as {
          PolicyDocument: {
            Statement: { Action: unknown; Resource: unknown }[];
          };
        }
      ).PolicyDocument.Statement;
      for (const statement of statements) {
        if (JSON.stringify(statement.Action).includes("s3:")) {
          expect(statement.Resource).not.toBe("*");
        }
      }
    }
  });
});

describe("storage lifecycle and secret stability", () => {
  test("old private-content versions expire after 30 days", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      VersioningConfiguration: { Status: "Enabled" },
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({
            NoncurrentVersionExpiration: { NoncurrentDays: 30 },
            AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
          }),
        ]),
      },
    });
  });

  test("secret generation settings stay fixed (changing them regenerates real keys)", () => {
    const secrets = template.findResources("AWS::SecretsManager::Secret");
    for (const secret of Object.values(secrets)) {
      expect(
        (secret["Properties"] as { GenerateSecretString: unknown })
          .GenerateSecretString,
      ).toEqual({ PasswordLength: 48, ExcludePunctuation: true });
    }
  });
});

describe("events (DB-5, VM mode)", () => {
  test("one Firehose stream writes date-partitioned events to the Events bucket", () => {
    expectEventStream(template, "interval-prod-events");
  });

  test("the VM may only put records to the stream", () => {
    expect(firehoseActionsFor(template, "InstanceRole")).toEqual([
      "firehose:PutRecord",
      "firehose:PutRecordBatch",
    ]);
  });
});
