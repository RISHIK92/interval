import { afterEach, expect, test, vi } from "vitest";

const original = process.env["DATABASE_URL"];

afterEach(() => {
  process.env["DATABASE_URL"] = original;
  vi.restoreAllMocks();
  vi.resetModules();
});

async function callRoute(databaseUrl: string): Promise<Response> {
  process.env["DATABASE_URL"] = databaseUrl;
  const { GET } = await import("./route");
  return GET();
}

test("GET returns 200 with only a status body and no caching when the database is up", async () => {
  if (original === undefined) throw new Error("DATABASE_URL is not set");
  const res = await callRoute(original);

  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(await res.json()).toEqual({ status: "ok" });
});

test("GET returns 503 when the database is unreachable", async () => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const res = await callRoute(
    "postgres://interval:interval@127.0.0.1:1/interval",
  );

  expect(res.status).toBe(503);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(await res.json()).toEqual({ status: "unavailable" });
});
