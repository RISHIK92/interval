import { env } from "./env";
import { log } from "./server/log";

// Next calls register() once at server start. Next only logs a register() error and keeps
// serving, so a bad environment exits here instead: the container must not start half-configured.
export async function register(): Promise<void> {
  if (process.env["NEXT_RUNTIME"] !== "nodejs") return;
  try {
    env();
  } catch (error) {
    log.error("startup: invalid environment", { error });
    process.exit(1);
  }
  // Imported here, not at the top: these are Node-only and Next also bundles this file
  // for the Edge runtime.
  const [{ registerOTel }, { tracingOptions }, { events }] = await Promise.all([
    import("@vercel/otel"),
    import("./server/tracing"),
    import("./server/container"),
  ]);
  registerOTel(tracingOptions(process.env["OTEL_TRACES_EXPORTER"]));
  // Best effort when a container stops (ECS or compose): Next's own SIGTERM handler
  // closes the server and exits without waiting for this, so events buffered in the last
  // second or so can still be lost. Acceptable for analytics (S14 plan, risks).
  process.once("SIGTERM", () => {
    void events().flush();
  });
}
