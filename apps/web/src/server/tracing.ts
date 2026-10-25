import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
} from "@opentelemetry/sdk-trace-base";
import type { Configuration } from "@vercel/otel";

// OPS-2. Explicit lists, because @vercel/otel's defaults would export over OTLP to
// localhost:4318 even when nothing asked for it, and would trust a caller's traceparent.
// - Export: spans print only for OTEL_TRACES_EXPORTER=console (owner choice); the beta's
//   ADOT sidecar adds its OTLP processor here.
// - Propagation: none inbound. Nothing in front of the app (Caddy, ALB) sends
//   traceparent, so an incoming one is a caller choosing our trace ids.
export function tracingOptions(exporter: string | undefined): Configuration {
  return {
    serviceName: "interval-web",
    propagators: [],
    spanProcessors:
      exporter === "console"
        ? [new BatchSpanProcessor(new ConsoleSpanExporter())]
        : [],
  };
}
