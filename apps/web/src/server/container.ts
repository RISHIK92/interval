import type { DB } from "@interval/db";
import type { Kysely } from "kysely";
import { env } from "../env";
import { createDb, kyselyFeedReader, kyselyPing } from "./adapters/kysely";
import type { DatabasePing, FeedReader } from "./ports";

// Composition root (ADR-0012): the only place that picks adapters. Lazy, because
// `next build` imports route modules without a runtime environment.
let database: Kysely<DB> | undefined;

function db(): Kysely<DB> {
  database ??= createDb(env().DATABASE_URL);
  return database;
}

export function feedReader(): FeedReader {
  return kyselyFeedReader(db());
}

export function databasePing(): DatabasePing {
  return kyselyPing(db());
}
