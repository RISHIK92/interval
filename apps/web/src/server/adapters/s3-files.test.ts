import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { beforeAll, expect, test } from "vitest";
import { parseFilesEnv } from "../../env";
import { s3Files } from "./s3-files";

// The file store against local SeaweedFS (ADR-0011), as S3 is in AWS (P2-W11-S01).
const config = parseFilesEnv(process.env);
const client = new S3Client({
  region: config.AWS_REGION,
  ...(config.S3_ENDPOINT === undefined
    ? {}
    : { endpoint: config.S3_ENDPOINT, forcePathStyle: true }),
});
const bucket = config.PRIVATE_CONTENT_BUCKET;

beforeAll(async () => {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }
});

test("a file is stored, read back, and removed; removing nothing isn't an error", async () => {
  const files = s3Files(client, bucket);
  const key = `test/${randomUUID()}.pdf`;
  await files.put(key, new TextEncoder().encode("%PDF-1.7"), "application/pdf");
  const got = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  expect(got.ContentType).toBe("application/pdf");
  expect(await got.Body?.transformToString()).toBe("%PDF-1.7");
  await files.remove(key);
  await expect(
    client.send(new GetObjectCommand({ Bucket: bucket, Key: key })),
  ).rejects.toThrow();
  await files.remove(key);
});
