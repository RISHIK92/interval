import { describe, expect, test } from "vitest";
import {
  parseEnv,
  parseFilesEnv,
  parseGameEnv,
  parseGitHubEnv,
  parsePushEnv,
} from "./env";

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
    const sqs = { ...valid, QUEUE_TRANSPORT: "sqs" };
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

  // P3-W14-S01: leaderboards live in Valkey whichever queue is used.
  test("Valkey is needed with SQS too", () => {
    expect(() =>
      parseEnv({
        ...valid,
        QUEUE_TRANSPORT: "sqs",
        VALKEY_URL: undefined,
        SQS_QUEUE_URL_PREFIX:
          "https://sqs.ap-south-1.amazonaws.com/1/interval-",
        AWS_REGION: "ap-south-1",
      }),
    ).toThrow(/VALKEY_URL/);
  });

  test("returns typed values for a valid environment", () => {
    // No proxy in front unless said (P3-W13-S07).
    expect(parseEnv(valid)).toEqual({ ...valid, TRUSTED_PROXIES: 0 });
  });

  test("reads how many proxies stand in front, within reason", () => {
    expect(parseEnv({ ...valid, TRUSTED_PROXIES: "2" }).TRUSTED_PROXIES).toBe(
      2,
    );
    for (const bad of ["-1", "1.5", "9", "many"])
      expect(() => parseEnv({ ...valid, TRUSTED_PROXIES: bad })).toThrow(
        /TRUSTED_PROXIES/,
      );
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

describe("parseFilesEnv (P2-W11-S01)", () => {
  const files = {
    PRIVATE_CONTENT_BUCKET: "interval-private",
    AWS_REGION: "us-east-1",
  };
  test("takes the bucket and region, and an optional endpoint (SeaweedFS)", () => {
    expect(parseFilesEnv(files)).toEqual(files);
    expect(
      parseFilesEnv({ ...files, S3_ENDPOINT: "http://127.0.0.1:8333" }),
    ).toMatchObject({ S3_ENDPOINT: "http://127.0.0.1:8333" });
  });
  test("names what's missing or wrong", () => {
    expect(() => parseFilesEnv({ AWS_REGION: "us-east-1" })).toThrow(
      /PRIVATE_CONTENT_BUCKET/,
    );
    expect(() => parseFilesEnv({ ...files, S3_ENDPOINT: "ftp://x" })).toThrow(
      /S3_ENDPOINT/,
    );
  });
});

describe("parseGitHubEnv (P2-W12-S01)", () => {
  const app = {
    GITHUB_APP_SLUG: "interval-dev",
    GITHUB_APP_CLIENT_ID: "Iv23liAbC",
    GITHUB_APP_CLIENT_SECRET: "f".repeat(40),
  };
  test("takes the App's slug, client id and secret; none set means not offered", () => {
    expect(parseGitHubEnv(app)).toEqual(app);
    expect(parseGitHubEnv({})).toBeNull();
    // The stacks' generated placeholders, before the App is registered.
    expect(
      parseGitHubEnv({
        GITHUB_APP_SLUG: "aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bC1dE3fG5hJ7kL9mN1pQ3",
        GITHUB_APP_CLIENT_ID:
          "xY1zA2bC3dE4fG5hJ6kL7mN8pQ9rS0tU1vW2xY3zA4bC5dE6",
        GITHUB_APP_CLIENT_SECRET:
          "qW1eR2tY3uI4oP5aS6dF7gH8jK9lZ0xC1vB2nM3qW4eR5tY6",
      }),
    ).toBeNull();
  });
  test("some but not all set is a mistake, named", () => {
    expect(() => parseGitHubEnv({ GITHUB_APP_SLUG: "interval-dev" })).toThrow(
      /GITHUB_APP_CLIENT_ID/,
    );
    expect(() =>
      parseGitHubEnv({ ...app, GITHUB_APP_SLUG: "has spaces" }),
    ).toThrow(/GITHUB_APP_SLUG/);
  });
});

// P3-W15-S02 (ADR-0033): the match ticket secret, shared with the game server. Optional:
// without it, live games aren't offered.
describe("game ticket secret", () => {
  test("absent: no live games", () => {
    expect(parseGameEnv({})).toBeNull();
    expect(parseGameEnv({ GAME_TICKET_SECRET: "" })).toBeNull();
  });

  test("present: at least 32 characters", () => {
    const secret = "0123456789abcdef0123456789abcdef";
    expect(parseGameEnv({ GAME_TICKET_SECRET: secret })).toEqual({
      GAME_TICKET_SECRET: secret,
    });
    expect(() => parseGameEnv({ GAME_TICKET_SECRET: "short" })).toThrow(
      /GAME_TICKET_SECRET/,
    );
  });
});

// P3-W17-S05b: web push is offered only with a well-formed public key.
describe("parsePushEnv", () => {
  test("not set: push is off; a malformed key is refused; a key is kept", () => {
    expect(parsePushEnv({})).toBeNull();
    expect(parsePushEnv({ VAPID_PUBLIC_KEY: "Ab3".repeat(16) })).toBeNull();
    expect(() => parsePushEnv({ VAPID_PUBLIC_KEY: "nope" })).toThrow(
      "Invalid VAPID_PUBLIC_KEY",
    );
    const key = `B${"a".repeat(86)}`;
    expect(parsePushEnv({ VAPID_PUBLIC_KEY: key })).toEqual({
      VAPID_PUBLIC_KEY: key,
    });
  });
});
