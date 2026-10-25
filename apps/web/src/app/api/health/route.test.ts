import { afterEach, expect, test, vi } from "vitest";
import { recordSpans } from "../../../server/otel-test-setup";

const original = process.env["DATABASE_URL"];

afterEach(() => {
  process.env["DATABASE_URL"] = original;
  vi.restoreAllMocks();
  vi.resetModules();
});

async function callRoute(
  databaseUrl: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  process.env["DATABASE_URL"] = databaseUrl;
  const { GET } = await import("./route");
  return GET(new Request("http://localhost:3100/api/health", { headers }));
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

// OPS-2: one span per health request, carrying the request id to join logs and traces.
test("a health request runs in a health.check span with its request id", async () => {
  if (original === undefined) throw new Error("DATABASE_URL is not set");
  const spans = recordSpans();
  await callRoute(original, { "x-request-id": "req-123" });
  await callRoute(original);
  await callRoute(original, { "x-request-id": "x".repeat(129) });
  await callRoute(original, { "x-request-id": "bad id with spaces!" });
  const checks = spans
    .getFinishedSpans()
    .filter((span) => span.name === "health.check");
  expect(checks).toHaveLength(4);
  expect(checks[0]?.attributes["request_id"]).toBe("req-123");
  // Missing, too long or oddly shaped: a fresh id is made instead.
  for (const check of checks.slice(1)) {
    expect(check.attributes["request_id"]).toMatch(/^[0-9a-f-]{36}$/);
  }
});
