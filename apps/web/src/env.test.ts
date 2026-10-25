import { describe, expect, test } from "vitest";
import { parseEnv } from "./env";

const valid = {
  DATABASE_URL: "postgres://user:s3cret@localhost:5432/interval",
  NODE_ENV: "production",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3100",
  MAIL_TRANSPORT: "log",
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
