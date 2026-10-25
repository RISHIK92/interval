import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Size,
  Stack,
  type StackProps,
} from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import type { Construct } from "constructs";
import { createBuckets } from "./storage.ts";

// Beta hosting (owner, 2026-10-25): one VM runs Postgres+pgvector, the web app and the
// worker in Docker. This replaces RDS (DB-1) and Fargate (LOAD-1) for the beta; no ADR
// by owner choice. No NAT: the VM sits in a public subnet behind a 80/443-only group.
// Synth only until the beta deploy (ADR-0005).

// Pinned Amazon Linux 2023 arm64 image. Never resolve "latest" at deploy time: a new
// AMI would replace the VM, and the replacement cannot take over the attached data
// volume. Updating the OS is a deliberate change (stop VM, detach volume, deploy; S09).
export const AMI_ID = "ami-0aa469bdf3050f74f"; // al2023 arm64, ap-south-1, looked up 2026-10-25

const DATA_DEVICE = "/dev/sdf";
export const DATA_MOUNT = "/var/lib/interval/pgdata";
// Amazon Linux 2023 does not package the compose plugin; pinned release binary + digest
// (verified against the release's checksums.txt).
const COMPOSE_VERSION = "v5.6.1";
const COMPOSE_SHA256 =
  "42cfa75f51ad0ccf290bad37899e0038a8c10a0069e85233ecc1d53e3ff1347d";
// The deploy builds images with BuildKit features (cache mounts); AL2023's docker package
// has no buildx plugin. Pinned release binary + digest.
const BUILDX_VERSION = "v0.38.1";
const BUILDX_SHA256 =
  "3b83b3731916ba433feccaaa689fe5bcdc81c641d92c8e6c2ea865dfa141c97a";

// Changing these regenerates every secret on the next deploy, which would overwrite the
// owner's real OpenRouter/Voyage keys and the live Postgres password. Do not edit.
export const SECRET_GENERATION = {
  passwordLength: 48,
  excludePunctuation: true,
} as const;
export const SECRET_NAMES = [
  "interval/prod/postgres",
  "interval/prod/better-auth",
  // Generated placeholders: the owner replaces them with the real API keys (ADR-0007).
  "interval/prod/openrouter",
  "interval/prod/voyage",
];

export class ProdStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: "public", subnetType: ec2.SubnetType.PUBLIC },
      ],
    });

    const web = new ec2.SecurityGroup(this, "WebSg", {
      vpc,
      description: "HTTP and HTTPS only; shell access is through SSM, not SSH",
      allowAllOutbound: true,
    });
    for (const port of [80, 443]) {
      web.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(port));
    }

    const role = new iam.Role(this, "InstanceRole", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "AmazonSSMManagedInstanceCore",
        ),
      ],
    });

    // The VM and its data volume share one subnet's AZ. Taking the AZ from the subnet,
    // not the instance, avoids a cycle (user data names the volume).
    const subnet = vpc.publicSubnets[0];
    if (subnet === undefined) throw new Error("VPC has no public subnet");

    // Postgres data lives on its own volume and survives replacing the instance.
    const data = new ec2.Volume(this, "PgData", {
      availabilityZone: subnet.availabilityZone,
      size: Size.gibibytes(30),
      volumeType: ec2.EbsDeviceVolumeType.GP3,
      encrypted: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const userData = ec2.UserData.forLinux();
    const instance = new ec2.Instance(this, "Vm", {
      vpc,
      vpcSubnets: { subnets: [subnet] },
      instanceType: new ec2.InstanceType("t4g.medium"),
      machineImage: ec2.MachineImage.genericLinux({ "ap-south-1": AMI_ID }),
      securityGroup: web,
      role,
      requireImdsv2: true,
      userData,
      blockDevices: [
        {
          deviceName: "/dev/xvda",
          volume: ec2.BlockDeviceVolume.ebs(20, {
            encrypted: true,
            volumeType: ec2.EbsDeviceVolumeType.GP3,
          }),
        },
      ],
    });

    new ec2.CfnVolumeAttachment(this, "PgDataAttachment", {
      instanceId: instance.instanceId,
      volumeId: data.volumeId,
      device: DATA_DEVICE,
    });

    // First boot only: cloud-init runs user data once per instance, so later edits here
    // apply only to a new instance. CloudFormation waits for the success signal, so a
    // failed step fails the deploy instead of leaving a half-built VM.
    instance.instance.cfnOptions.creationPolicy = {
      resourceSignal: { count: 1, timeout: Duration.minutes(15).toIsoString() },
    };
    userData.addSignalOnExitCommand(instance);
    userData.addCommands(
      "set -euo pipefail",
      "dnf install -y docker git",
      "mkdir -p /usr/local/lib/docker/cli-plugins",
      `curl -fsSL -o /usr/local/lib/docker/cli-plugins/docker-compose https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-aarch64`,
      `echo "${COMPOSE_SHA256}  /usr/local/lib/docker/cli-plugins/docker-compose" | sha256sum --check`,
      "chmod +x /usr/local/lib/docker/cli-plugins/docker-compose",
      `curl -fsSL -o /usr/local/lib/docker/cli-plugins/docker-buildx https://github.com/docker/buildx/releases/download/${BUILDX_VERSION}/buildx-${BUILDX_VERSION}.linux-arm64`,
      `echo "${BUILDX_SHA256}  /usr/local/lib/docker/cli-plugins/docker-buildx" | sha256sum --check`,
      "chmod +x /usr/local/lib/docker/cli-plugins/docker-buildx",
      // Nitro exposes EBS as NVMe; the volume id without the dash is the device serial.
      `VOLUME_ID="${data.volumeId}"`,
      'SERIAL="${VOLUME_ID//-/}"',
      "DEV=''",
      'for i in $(seq 1 60); do DEV="$(lsblk -dno PATH,SERIAL | awk -v s="$SERIAL" \'$2==s {print $1}\')"; [ -n "$DEV" ] && break; sleep 5; done',
      '[ -n "$DEV" ] || { echo "data volume not attached" >&2; exit 1; }',
      // Format only a blank volume: blkid -p exits 2 for "no filesystem". Never add -f.
      'rc=0; blkid -p "$DEV" || rc=$?',
      'if [ "$rc" -eq 2 ]; then mkfs -t xfs "$DEV"; elif [ "$rc" -ne 0 ]; then echo "blkid failed ($rc) on $DEV" >&2; exit 1; fi',
      `mkdir -p ${DATA_MOUNT}`,
      `grep -q " ${DATA_MOUNT} " /etc/fstab || echo "UUID=$(blkid -s UUID -o value "$DEV") ${DATA_MOUNT} xfs defaults,nofail 0 2" >> /etc/fstab`,
      "mount -a",
      `mountpoint -q ${DATA_MOUNT}`,
      // Docker (and so Postgres) only starts with the data volume mounted: with nofail, a
      // missing volume would otherwise leave an empty directory on the root disk.
      "mkdir -p /etc/systemd/system/docker.service.d",
      `printf '[Unit]\\nRequiresMountsFor=${DATA_MOUNT}\\n' > /etc/systemd/system/docker.service.d/interval-data.conf`,
      "systemctl daemon-reload",
      "systemctl enable --now docker",
    );

    // Retained: DNS will point at this address.
    const eip = new ec2.CfnEIP(this, "Ip", { domain: "vpc" });
    eip.applyRemovalPolicy(RemovalPolicy.RETAIN);
    new ec2.CfnEIPAssociation(this, "IpAssociation", {
      allocationId: eip.attrAllocationId,
      instanceId: instance.instanceId,
    });

    const { privateContent, events } = createBuckets(this);
    // The VM may read and add objects but never delete, so old versions stay recoverable.
    privateContent.grantRead(role);
    privateContent.grantPut(role);

    for (const name of SECRET_NAMES) {
      const secret = new secretsmanager.Secret(
        this,
        name.replaceAll("/", "-"),
        {
          secretName: name,
          generateSecretString: { ...SECRET_GENERATION },
          removalPolicy: RemovalPolicy.RETAIN,
        },
      );
      secret.grantRead(role);
      new CfnOutput(this, `${name.replaceAll("/", "-")}-arn`, {
        value: secret.secretArn,
      });
    }

    new CfnOutput(this, "InstanceId", { value: instance.instanceId });
    new CfnOutput(this, "PublicIp", { value: eip.ref });
    new CfnOutput(this, "PrivateContentBucket", {
      value: privateContent.bucketName,
    });
    new CfnOutput(this, "EventsBucket", { value: events.bucketName });
  }
}
