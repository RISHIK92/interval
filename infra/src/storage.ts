import { Duration, RemovalPolicy, Size, Stack } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as firehose from "aws-cdk-lib/aws-kinesisfirehose";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";

const NONCURRENT_VERSION_DAYS = 30; // owner, 2026-10-25

export type Buckets = { privateContent: s3.Bucket; events: s3.Bucket };

// The same two buckets in both deployment modes (ADR-0011). Created directly in the
// given scope, so the VM stack's logical ids are unchanged.
export function createBuckets(scope: Construct): Buckets {
  const props: s3.BucketProps = {
    blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    encryption: s3.BucketEncryption.S3_MANAGED,
    enforceSSL: true,
    removalPolicy: RemovalPolicy.RETAIN,
  };
  // DB-6: private encrypted files. Versioned, since files are not reproducible.
  const privateContent = new s3.Bucket(scope, "PrivateContent", {
    ...props,
    versioned: true,
    lifecycleRules: [
      {
        noncurrentVersionExpiration: Duration.days(NONCURRENT_VERSION_DAYS),
        abortIncompleteMultipartUploadAfter: Duration.days(7),
      },
    ],
  });
  // DB-5: events from Firehose, queried by Athena.
  const events = new s3.Bucket(scope, "Events", props);
  return { privateContent, events };
}

// DB-5: events from both apps into the Events bucket as JSON lines, one prefix per day
// so Athena can prune by date (W6-S04). Five minutes or 5 MB per object keeps the object
// count low at beta volume. The bucket's S3-managed key encrypts the objects.
export function createEventStream(
  scope: Construct,
  bucket: s3.IBucket,
  name: string,
): firehose.DeliveryStream {
  // The destination's default grant includes deleting objects; no role here deletes
  // from S3. So the role is closed to CDK grants and gets AWS's documented S3 delivery
  // actions, plus its own error log.
  const role = new iam.Role(scope, "EventStreamRole", {
    assumedBy: new iam.ServicePrincipal("firehose.amazonaws.com"),
    // Firehose passes the account as the external ID; this stops another account's
    // stream from using the role (confused deputy).
    externalIds: [Stack.of(scope).account],
  });
  const errors = new logs.LogGroup(scope, "EventStreamErrors", {
    retention: logs.RetentionDays.ONE_MONTH,
    removalPolicy: RemovalPolicy.DESTROY,
  });
  errors.grantWrite(role);
  role.addToPolicy(
    new iam.PolicyStatement({
      actions: [
        "s3:AbortMultipartUpload",
        "s3:GetBucketLocation",
        "s3:GetObject",
        "s3:ListBucket",
        "s3:ListBucketMultipartUploads",
        "s3:PutObject",
      ],
      resources: [bucket.bucketArn, bucket.arnForObjects("*")],
    }),
  );
  const stream = new firehose.DeliveryStream(scope, "EventStream", {
    deliveryStreamName: name,
    destination: new firehose.S3Bucket(bucket, {
      role: role.withoutPolicyUpdates(),
      loggingConfig: new firehose.EnableLogging(errors),
      dataOutputPrefix: "events/dt=!{timestamp:yyyy-MM-dd}/",
      errorOutputPrefix:
        "errors/!{firehose:error-output-type}/dt=!{timestamp:yyyy-MM-dd}/",
      bufferingInterval: Duration.minutes(5),
      bufferingSize: Size.mebibytes(5),
    }),
  });
  // Without CDK's grants there is no implicit ordering: the role and its policy must
  // exist before Firehose first assumes it.
  stream.node.addDependency(role);
  return stream;
}
