import { readFileSync } from "node:fs";
import path from "node:path";
import { Stack } from "aws-cdk-lib";
import * as autoscaling from "aws-cdk-lib/aws-autoscaling";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { DockerImageAsset, Platform } from "aws-cdk-lib/aws-ecr-assets";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";

// P5-W28-S05 (EXEC-5, EXEC-3; Q-P5-02, Q-P5-05; ADR-0039 PROPOSED): the execution
// hosts. ECS on EC2, not Fargate, in subnets with no route out: they reach only the VPC
// endpoints and Valkey. Each boots with gVisor (runsc) registered with Docker and every
// language image already pulled, copied into ECR with the stack since Docker Hub is out
// of reach. The exec service itself (its task and its queue) arrives with its consumer
// in W31-S01; scaling on queue depth and before windows in W32-S03.

const REPO_ROOT = path.join(import.meta.dirname, "../..");
const EXEC_DIR = path.join(REPO_ROOT, "services/exec");

// The engine's own list (services/exec/engine/images.json): one source for both.
export const EXEC_IMAGES = JSON.parse(
  readFileSync(path.join(EXEC_DIR, "engine/images.json"), "utf8"),
) as Record<string, { image: string; build?: string }>;

// The run directories: the same path on the host and in the exec service's container.
export const EXEC_WORK_DIR = "/var/lib/interval-exec";

export function createExecHosts(
  scope: Construct,
  props: { vpc: ec2.Vpc; dataSg: ec2.SecurityGroup },
) {
  const { vpc, dataSg } = props;
  const subnets: ec2.SubnetSelection = { subnetGroupName: "exec" };

  const hostSg = new ec2.SecurityGroup(scope, "ExecHostSg", {
    vpc,
    description:
      "Execution hosts: no inbound; out only to endpoints and Valkey",
    allowAllOutbound: false,
  });
  // The exec subnets have no route out of the VPC, so 443 reaches only the endpoints,
  // and S3 only for ECR's layers and Amazon Linux's packages (ExecS3's policy).
  hostSg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443));
  hostSg.addEgressRule(dataSg, ec2.Port.tcp(6379));
  dataSg.addIngressRule(hostSg, ec2.Port.tcp(6379));

  // Private DNS makes these the answer for ECR, ECS and Logs across the whole VPC, so
  // every subnet's tasks reach them too: open to the VPC, not just the hosts.
  const endpointSg = new ec2.SecurityGroup(scope, "ExecEndpointSg", {
    vpc,
    description: "VPC endpoints for the isolated execution hosts",
    allowAllOutbound: false,
  });
  endpointSg.addIngressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(443));
  const services: [string, ec2.InterfaceVpcEndpointAwsService][] = [
    ["Ecr", ec2.InterfaceVpcEndpointAwsService.ECR],
    ["EcrDocker", ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER],
    ["Logs", ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS],
    ["Ecs", ec2.InterfaceVpcEndpointAwsService.ECS],
    ["EcsAgent", ec2.InterfaceVpcEndpointAwsService.ECS_AGENT],
    ["EcsTelemetry", ec2.InterfaceVpcEndpointAwsService.ECS_TELEMETRY],
  ];
  for (const [id, service] of services) {
    vpc.addInterfaceEndpoint(`Exec${id}Endpoint`, {
      service,
      subnets,
      securityGroups: [endpointSg],
      privateDnsEnabled: true,
    });
  }

  // The exec subnets' own S3 route, for the two buckets their hosts need: anything that
  // got onto a host can't write to other buckets through it.
  const { region, account } = Stack.of(scope);
  const s3 = vpc.addGatewayEndpoint("ExecS3", {
    service: ec2.GatewayVpcEndpointAwsService.S3,
    subnets: [subnets],
  });
  s3.addToPolicy(
    new iam.PolicyStatement({
      principals: [new iam.AnyPrincipal()],
      actions: ["s3:GetObject"],
      resources: [
        `arn:aws:s3:::prod-${region}-starport-layer-bucket/*`,
        `arn:aws:s3:::al2023-repos-${region}-de612dc2/*`,
      ],
    }),
  );

  const arm = Platform.LINUX_ARM64;
  const runsc = new DockerImageAsset(scope, "ExecRunscImage", {
    directory: path.join(EXEC_DIR, "images/runsc"),
    platform: arm,
  });
  // One asset per distinct image (JavaScript and TypeScript share Node's).
  const distinct = new Map<string, { image: string; build?: string }>();
  for (const entry of Object.values(EXEC_IMAGES))
    distinct.set(entry.build ?? entry.image, entry);
  const images = [...distinct.values()].map(
    (entry, i) =>
      new DockerImageAsset(scope, `ExecImage${String(i)}`, {
        directory:
          entry.build === undefined
            ? path.join(EXEC_DIR, "images/mirror")
            : path.join(REPO_ROOT, entry.build),
        ...(entry.build === undefined
          ? { buildArgs: { IMAGE: entry.image } }
          : {}),
        platform: arm,
      }),
  );

  // An explicit launch template: launch configurations can't be used in new accounts.
  const role = new iam.Role(scope, "ExecHostRole", {
    assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
  });
  const userData = ec2.UserData.forLinux();
  const template = new ec2.LaunchTemplate(scope, "ExecHostTemplate", {
    instanceType: new ec2.InstanceType("c7g.large"),
    machineImage: ecs.EcsOptimizedImage.amazonLinux2023(
      ecs.AmiHardwareType.ARM,
    ),
    securityGroup: hostSg,
    requireImdsv2: true,
    role,
    userData,
    blockDevices: [
      {
        deviceName: "/dev/xvda",
        volume: ec2.BlockDeviceVolume.ebs(40, {
          volumeType: ec2.EbsDeviceVolumeType.GP3,
          encrypted: true,
        }),
      },
    ],
  });
  const asg = new autoscaling.AutoScalingGroup(scope, "ExecHosts", {
    vpc,
    vpcSubnets: subnets,
    launchTemplate: template,
    minCapacity: 0,
    maxCapacity: 4,
  });
  for (const asset of [runsc, ...images]) asset.repository.grantPull(role);

  const registry = `${account}.dkr.ecr.${region}.amazonaws.com`;
  userData.addCommands(
    "set -euo pipefail",
    // A host that can't finish booting stops, so the group replaces it and the failure
    // shows, rather than a healthy-looking host that never joins the cluster.
    "trap 'echo \"exec host setup failed at line $LINENO\" >&2; shutdown -h now' ERR",
    // The ECS-optimized AMI is minimal; its packages come through ExecS3.
    "command -v aws >/dev/null || dnf install -y awscli-2",
    `aws ecr get-login-password --region ${region} | docker login --username AWS --password-stdin ${registry}`,
    // gVisor: copied out of its image, registered with Docker as runsc (EXEC_RUNTIME).
    `docker pull ${runsc.imageUri}`,
    `cid="$(docker create ${runsc.imageUri} none)"`,
    'docker cp "$cid:/runsc" /usr/local/bin/runsc',
    'docker rm "$cid"',
    "chmod 755 /usr/local/bin/runsc",
    "/usr/local/bin/runsc --version",
    // Merged into whatever the AMI ships, never overwriting it.
    `python3 -c 'import json, os; p = "/etc/docker/daemon.json"; c = json.load(open(p)) if os.path.exists(p) else {}; c.setdefault("runtimes", {})["runsc"] = {"path": "/usr/local/bin/runsc"}; json.dump(c, open(p, "w"))'`,
    "systemctl restart docker",
    // Q-P5-05: every language image is here before the first run.
    ...images.map((image) => `docker pull ${image.imageUri}`),
    `mkdir -p ${EXEC_WORK_DIR}`,
  );

  const cluster = new ecs.Cluster(scope, "ExecCluster", { vpc });
  cluster.addAsgCapacityProvider(
    new ecs.AsgCapacityProvider(scope, "ExecCapacity", {
      autoScalingGroup: asg,
      enableManagedTerminationProtection: false,
    }),
  );
  return { cluster, hostSg, images };
}
