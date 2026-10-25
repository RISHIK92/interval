import { afterEach, expect, test, vi } from "vitest";
import { checkHealth } from "./health";
import type { DatabasePing } from "./ports";

// Health logic on fake pings (ADR-0012); the real database cases are in
// adapters/kysely-ping.test.ts.

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function captureLines(): string[] {
  const lines: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation(
    (chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    },
  );
  return lines;
}

test("ok with 200 when the ping resolves", async () => {
  const ping: DatabasePing = { ping: () => Promise.resolve() };
  expect(await checkHealth(ping)).toEqual({ status: "ok", httpStatus: 200 });
});

test("unavailable with 503 and one error log when the ping rejects", async () => {
  const lines = captureLines();
  const ping: DatabasePing = {
    ping: () => Promise.reject(new Error("refused")),
  };

  expect(await checkHealth(ping)).toEqual({
    status: "unavailable",
    httpStatus: 503,
  });
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0] ?? "")).toMatchObject({
    level: "error",
    msg: "health check: database unreachable",
    error: { message: "refused" },
  });
});

test("unavailable after the timeout when the ping never settles", async () => {
  captureLines();
  vi.useFakeTimers();
  const ping: DatabasePing = { ping: () => new Promise<void>(() => undefined) };

  const result = checkHealth(ping);
  await vi.advanceTimersByTimeAsync(2000);
  expect(await result).toEqual({ status: "unavailable", httpStatus: 503 });
});
