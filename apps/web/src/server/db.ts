import type { DB } from "@interval/db";
import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import { env } from "../env";
import { log } from "./log";

// Bounded waits so a dead or stalled database fails requests fast instead of pinning the pool.
const CONNECT_TIMEOUT_MS = 2000;
const QUERY_TIMEOUT_MS = 10_000;

export function createDb(connectionString: string): Kysely<DB> {
  const pool = new pg.Pool({
    connectionString,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
    statement_timeout: QUERY_TIMEOUT_MS,
  });
  // An idle client can die (failover, restart); without a listener pg-pool's error is unhandled.
  pool.on("error", (error) => {
    log.error("db pool: idle client error", { error });
  });
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}

let instance: Kysely<DB> | undefined;

export function db(): Kysely<DB> {
  instance ??= createDb(env().DATABASE_URL);
  return instance;
}
