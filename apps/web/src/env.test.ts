import { describe, expect, test } from "vitest";
import { parseEnv } from "./env";

const valid = {
  DATABASE_URL: "postgres://user:s3cret@localhost:5432/interval",
  NODE_ENV: "production",
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
