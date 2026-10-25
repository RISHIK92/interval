import { describe, expect, test } from "vitest";
import { parseEnv } from "./env";

const valid = {
  DATABASE_URL: "postgres://user:s3cret@localhost:5432/interval",
  NODE_ENV: "production",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3100",
  MAIL_TRANSPORT: "log",
  EVENTS_TRANSPORT: "file",
  EVENTS_DIR: "/tmp/interval-events",
  QUEUE_TRANSPORT: "bullmq",
  VALKEY_URL: "redis://localhost:6379",
};

describe("parseEnv", () => {
  test("rejects a missing DATABASE_URL and names it", () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });

  test("rejects a DATABASE_URL that is not a URL", () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL: "not a url" })).toThrow(
      /DATABASE_URL/,
    );
  });

  test("rejects a URL that is not a Postgres URL", () => {
    expect(() =>
      parseEnv({ ...valid, DATABASE_URL: "https://example.com/db" }),
    ).toThrow(/DATABASE_URL/);
  });

  test("rejects a short Better Auth secret", () => {
    expect(() => parseEnv({ ...valid, BETTER_AUTH_SECRET: "short" })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });

  test("requires a mail transport", () => {
    expect(() => parseEnv({ ...valid, MAIL_TRANSPORT: undefined })).toThrow(
      /MAIL_TRANSPORT/,
    );
  });

  // Logged mail carries reset links, so it is for local sites only (Q-P1-33).
  test.each(["https://interval.rishiklabs.tech", "http://10.0.0.5:8080"])(
    "refuses the log mail transport for the public site %s",
    (url) => {
      expect(() => parseEnv({ ...valid, BETTER_AUTH_URL: url })).toThrow(
        /MAIL_TRANSPORT/,
      );
    },
  );

  test.each(["http://localhost:8080", "http://127.0.0.1:3100"])(
    "allows the log mail transport for the local site %s",
    (url) => {
      expect(parseEnv({ ...valid, BETTER_AUTH_URL: url }).MAIL_TRANSPORT).toBe(
        "log",
      );
    },
  );

  // DB-5: Firehose when deployed, a local file in development.
  test("the file event transport needs a directory", () => {
    expect(() => parseEnv({ ...valid, EVENTS_DIR: undefined })).toThrow(
      /EVENTS_DIR/,
    );
  });

  test("the Firehose event transport needs a stream and a region", () => {
    const firehose = {
      ...valid,
      EVENTS_TRANSPORT: "firehose",
      EVENTS_DIR: undefined,
    };
    expect(() => parseEnv(firehose)).toThrow(/EVENTS_STREAM/);
    expect(() => parseEnv({ ...firehose, EVENTS_STREAM: "s" })).toThrow(
      /AWS_REGION/,
    );
    expect(
      parseEnv({ ...firehose, EVENTS_STREAM: "s", AWS_REGION: "ap-south-1" }),
    ).toMatchObject({ EVENTS_TRANSPORT: "firehose", EVENTS_STREAM: "s" });
  });

  // ADR-0014: BullMQ on Valkey locally and on the VM, SQS in the full-AWS mode.
  test("the BullMQ queue needs a Valkey URL", () => {
    expect(() => parseEnv({ ...valid, VALKEY_URL: undefined })).toThrow(
      /VALKEY_URL/,
    );
    expect(() => parseEnv({ ...valid, VALKEY_URL: "http://x" })).toThrow(
      /VALKEY_URL/,
    );
  });

  test("the SQS queue needs a URL prefix and a region", () => {
    const sqs = { ...valid, QUEUE_TRANSPORT: "sqs", VALKEY_URL: undefined };
    expect(() => parseEnv(sqs)).toThrow(/SQS_QUEUE_URL_PREFIX/);
    expect(
      parseEnv({
        ...sqs,
        SQS_QUEUE_URL_PREFIX:
          "https://sqs.ap-south-1.amazonaws.com/1/interval-",
        AWS_REGION: "ap-south-1",
      }),
    ).toMatchObject({ QUEUE_TRANSPORT: "sqs" });
  });

  test("returns typed values for a valid environment", () => {
    expect(parseEnv(valid)).toEqual(valid);
  });

  test("never includes variable values in the error", () => {
    const bad = { DATABASE_URL: "s3cret-but-not-a-url", NODE_ENV: "nope" };
    let message = "";
    try {
      parseEnv(bad);
    } catch (error) {
      message = String(error);
    }
    expect(message).toMatch(/DATABASE_URL/);
    expect(message).not.toContain("s3cret");
  });
});
