import { context, INVALID_SPAN_CONTEXT, trace } from "@opentelemetry/api";
import { afterEach, expect, test, vi } from "vitest";
import { log } from "./log";
import { recordSpans } from "./otel-test-setup";

afterEach(() => {
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

test("writes one JSON line per call with level, msg, time and fields", () => {
  const lines = captureLines();
  log.info("feed served", { userId: "u1", cards: 3 });

  expect(lines).toHaveLength(1);
  const line = lines[0] ?? "";
  expect(line.endsWith("\n")).toBe(true);
  const parsed = JSON.parse(line) as Record<string, unknown>;
  expect(parsed).toMatchObject({
    level: "info",
    msg: "feed served",
    userId: "u1",
    cards: 3,
  });
  expect(Number.isNaN(Date.parse(String(parsed["time"])))).toBe(false);
});

test("serialises an Error field with its name and message", () => {
  const lines = captureLines();
  log.error("db check failed", { error: new TypeError("boom") });

  const parsed = JSON.parse(lines[0] ?? "") as {
    level: string;
    error: Record<string, unknown>;
  };
  expect(parsed.level).toBe("error");
  expect(parsed.error).toMatchObject({ name: "TypeError", message: "boom" });
  expect(typeof parsed.error["stack"]).toBe("string");
});

test("keeps code, cause and nested errors, at any depth", () => {
  const lines = captureLines();
  const inner = Object.assign(new Error("refused"), { code: "ECONNREFUSED" });
  log.error("x", {
    ctx: { err: new AggregateError([inner], "", { cause: inner }) },
  });

  const parsed = JSON.parse(lines[0] ?? "") as {
    ctx: {
      err: {
        name: string;
        errors: { code: string }[];
        cause: { message: string };
      };
    };
  };
  expect(parsed.ctx.err.name).toBe("AggregateError");
  expect(parsed.ctx.err.errors[0]?.code).toBe("ECONNREFUSED");
  expect(parsed.ctx.err.cause.message).toBe("refused");
});

test("never throws on circular or BigInt fields", () => {
  const lines = captureLines();
  const loop: Record<string, unknown> = {};
  loop["self"] = loop;

  expect(() => {
    log.info("x", { loop, big: 10n });
  }).not.toThrow();
  expect(JSON.parse(lines[0] ?? "")).toMatchObject({
    big: "10",
    loop: { self: "[Circular]" },
  });
});

test("fields cannot overwrite level, msg or time", () => {
  const lines = captureLines();
  log.info("real", { level: "debug", msg: "fake" });

  expect(JSON.parse(lines[0] ?? "")).toMatchObject({
    level: "info",
    msg: "real",
  });
});

// OPS-2: a log line written inside a span can be joined to its trace.
test("inside a span a line carries its trace and span ids; outside it has none", () => {
  recordSpans();
  const lines = captureLines();
  let ids = { traceId: "", spanId: "" };
  trace.getTracer("test").startActiveSpan("work", (span) => {
    ids = span.spanContext();
    log.info("inside");
    span.end();
  });
  log.info("outside");
  const [inside, outside] = lines.map(
    (l) => JSON.parse(l) as Record<string, unknown>,
  );
  expect(inside).toMatchObject({ trace_id: ids.traceId, span_id: ids.spanId });
  expect(outside?.["trace_id"]).toBeUndefined();
});

test("an invalid span context adds no ids", () => {
  const lines = captureLines();
  const invalid = trace.wrapSpanContext(INVALID_SPAN_CONTEXT);
  context.with(trace.setSpan(context.active(), invalid), () => {
    log.info("inside an invalid span");
  });
  expect(JSON.parse(lines[0] ?? "")).not.toHaveProperty("trace_id");
});
