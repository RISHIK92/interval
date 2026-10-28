import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  type S3Client,
  S3ServiceException,
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
    get: async (key, etag) => {
      try {
        const object = await client.send(
          new GetObjectCommand({ Bucket: bucket, Key: key, IfNoneMatch: etag }),
        );
        if (object.Body === undefined) return null;
        return {
          // The SDK types the web stream's chunks as any; S3 bodies are bytes.
          body: object.Body.transformToWebStream() as ReadableStream<Uint8Array>,
          etag: object.ETag ?? null,
          size: object.ContentLength ?? null,
        };
      } catch (error) {
        if (error instanceof NoSuchKey) return null;
        // S3 answers a matching If-None-Match with 304.
        if (
          error instanceof S3ServiceException &&
          error.$metadata.httpStatusCode === 304
        )
          return "unchanged";
        throw error;
      }
    },
    remove: async (key) => {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}
