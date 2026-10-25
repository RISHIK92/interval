import { Duration, RemovalPolicy } from "aws-cdk-lib";
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
