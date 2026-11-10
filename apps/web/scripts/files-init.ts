// Creates the private content bucket (ADR-0011, P2-W11-S01) and the public media bucket
// (P4-W22-S04) in local SeaweedFS; the stacks create the real ones. Refuses anything but a local endpoint.
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
// P4-W22-S04 (CACHE-4): the public media bucket too, on the same local SeaweedFS.
const media = process.env["MEDIA_BUCKET"];
for (const name of media === undefined ? [bucket] : [bucket, media]) {
  try {
    await client.send(new HeadBucketCommand({ Bucket: name }));
    console.log(`${name} already exists`);
  } catch (error) {
    // Only a missing bucket is made; a server that's down or refuses us is reported.
    if (!(error instanceof NotFound)) throw error;
    await client.send(new CreateBucketCommand({ Bucket: name }));
    console.log(`created ${name}`);
  }
}
