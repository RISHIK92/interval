import { registerOTel } from "@vercel/otel";
import { env } from "./env";
import { events } from "./server/container";
import { log } from "./server/log";
import { tracingOptions } from "./server/tracing";

// The Node runtime's start (instrumentation.ts). Next only logs a register() error and
// keeps serving, so a bad environment exits here instead: the container must not start
// half-configured.
export function registerNode(): void {
  try {
    env();
  } catch (error) {
    log.error("startup: invalid environment", { error });
    process.exit(1);
  }
  registerOTel(tracingOptions(process.env["OTEL_TRACES_EXPORTER"]));
  // Best effort when a container stops (ECS or compose): Next's own SIGTERM handler
  // closes the server and exits without waiting for this, so events buffered in the last
  // second or so can still be lost. Acceptable for analytics (S14 plan, risks).
  process.once("SIGTERM", () => {
    void events().flush();
  });
}
