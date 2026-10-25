import { env } from "./env";
import { log } from "./server/log";

// Next calls register() once at server start. Next only logs a register() error and keeps
// serving, so a bad environment exits here instead: the container must not start half-configured.
export function register(): void {
  if (process.env["NEXT_RUNTIME"] !== "nodejs") return;
  try {
    env();
  } catch (error) {
    log.error("startup: invalid environment", { error });
    process.exit(1);
  }
}
