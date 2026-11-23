import { describe, expect, it } from "vitest";
import { localOnly } from "./demo-seed";

describe("demo:seed's local-host guard", () => {
  it.each([
    "postgres://interval:interval@localhost:5432/interval?sslmode=disable",
    "postgres://interval:interval@127.0.0.1:55433/interval",
    "postgres://interval:interval@[::1]:5432/interval",
  ])("accepts a local database: %s", (url) => {
    expect(localOnly("DATABASE_URL", url)).toEqual({ ok: true });
  });

  it("refuses a remote database", () => {
    expect(
      localOnly("DATABASE_URL", "postgres://u:p@db.example.com:5432/interval"),
    ).toEqual({
      ok: false,
      reason: "DATABASE_URL host db.example.com isn't local",
    });
  });

  it.each(["host", "hostaddr"])(
    "refuses a local URL whose %s= query names another host",
    (param) => {
      expect(
        localOnly(
          "DATABASE_URL",
          `postgres://u:p@localhost/interval?${param}=10.0.0.5`,
        ),
      ).toEqual({
        ok: false,
        reason: `DATABASE_URL sets ${param}= in its query`,
      });
    },
  );

  it("refuses something that isn't a URL", () => {
    expect(localOnly("DATABASE_URL", "localhost:5432")).toMatchObject({
      ok: false,
    });
  });

  it("holds Valkey to the same check", () => {
    expect(localOnly("VALKEY_URL", "redis://127.0.0.1:56379")).toEqual({
      ok: true,
    });
    expect(localOnly("VALKEY_URL", "redis://localhost:6379")).toEqual({
      ok: true,
    });
    expect(localOnly("VALKEY_URL", "rediss://cache.example.com:6379")).toEqual({
      ok: false,
      reason: "VALKEY_URL host cache.example.com isn't local",
    });
  });
});
