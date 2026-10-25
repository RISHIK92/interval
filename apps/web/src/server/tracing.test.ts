import { propagation, ROOT_CONTEXT, trace } from "@opentelemetry/api";
import { registerOTel } from "@vercel/otel";
import { expect, test } from "vitest";
import { tracingOptions } from "./tracing";

// OPS-2, owner choice: export only when asked (OTEL_TRACES_EXPORTER=console locally;
// ADOT adds OTLP at the beta).
test("nothing is exported unless console is asked for", () => {
  expect(tracingOptions(undefined).spanProcessors).toEqual([]);
  expect(tracingOptions("otlp").spanProcessors).toEqual([]);
  expect(tracingOptions("console").spanProcessors).toHaveLength(1);
});

// A trace id chosen by a caller on the internet must not become ours: nothing in front
// of the app (Caddy, ALB) sends traceparent, so there's nothing to trust.
test("an incoming traceparent header is ignored", () => {
  registerOTel(tracingOptions(undefined));
  const incoming = propagation.extract(ROOT_CONTEXT, {
    traceparent: `00-${"1".repeat(32)}-${"2".repeat(16)}-01`,
  });
  expect(trace.getSpanContext(incoming)).toBeUndefined();
});
