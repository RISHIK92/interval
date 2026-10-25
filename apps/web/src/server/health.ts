import type { DB } from "@interval/db";
import { sql, type Kysely } from "kysely";
import { log } from "./log";

const TIMEOUT_MS = 2000;

export type Health =
  | { status: "ok"; httpStatus: 200 }
  | { status: "unavailable"; httpStatus: 503 };

export async function checkHealth(db: Kysely<DB>): Promise<Health> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(`database did not answer within ${String(TIMEOUT_MS)} ms`),
      );
    }, TIMEOUT_MS);
  });
  try {
    await Promise.race([sql`select 1`.execute(db), timeout]);
    return { status: "ok", httpStatus: 200 };
  } catch (error) {
    log.error("health check: database unreachable", { error });
    return { status: "unavailable", httpStatus: 503 };
  } finally {
    clearTimeout(timer);
  }
}
