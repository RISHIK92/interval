import {
  DeleteObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import type { FileStore } from "../ports";

// DB-6: the private content bucket (S3-managed encryption, no public access; the
// stacks set it up). SeaweedFS stands in locally and on the VM (ADR-0011).
export function s3Files(client: S3Client, bucket: string): FileStore {
  return {
    put: async (key, bytes, contentType) => {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: bytes,
          ContentType: contentType,
        }),
      );
    },
    remove: async (key) => {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}
