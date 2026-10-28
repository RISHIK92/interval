// Creates the private content bucket in local SeaweedFS (ADR-0011, P2-W11-S01); the
// stacks create the real one. Refuses anything but a local endpoint.
import {
  CreateBucketCommand,
  HeadBucketCommand,
  NotFound,
  S3Client,
} from "@aws-sdk/client-s3";

const endpoint = process.env["S3_ENDPOINT"];
const bucket = process.env["PRIVATE_CONTENT_BUCKET"];
const region = process.env["AWS_REGION"];
if (endpoint === undefined || bucket === undefined || region === undefined) {
  console.error(
    "Set S3_ENDPOINT, PRIVATE_CONTENT_BUCKET and AWS_REGION in .env",
  );
  process.exit(1);
}
if (!["localhost", "127.0.0.1"].includes(new URL(endpoint).hostname)) {
  console.error(`Refusing a non-local endpoint: ${endpoint}`);
  process.exit(1);
}
const client = new S3Client({ region, endpoint, forcePathStyle: true });
try {
  await client.send(new HeadBucketCommand({ Bucket: bucket }));
  console.log(`${bucket} already exists`);
} catch (error) {
  // Only a missing bucket is made; a server that's down or refuses us is reported.
  if (!(error instanceof NotFound)) throw error;
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
  console.log(`created ${bucket}`);
}
