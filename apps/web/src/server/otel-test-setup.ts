import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { registerOTel } from "@vercel/otel";

// Tests only: the same registration as instrumentation.ts, with spans kept in memory.
// Once per test file: the global provider can be set once (vitest isolates files).
export function recordSpans(): InMemorySpanExporter {
  const exporter = new InMemorySpanExporter();
  registerOTel({
    serviceName: "interval-web-test",
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  return exporter;
}
