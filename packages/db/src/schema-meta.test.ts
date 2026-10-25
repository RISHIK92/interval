import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import { afterAll, expect, test } from "vitest";
import type { DB } from "./generated/db.js";

const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined) {
  throw new Error(
    "DATABASE_URL is not set; copy .env.example to .env and run `docker compose up -d`",
  );
}

const db = new Kysely<DB>({
  dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString }) }),
});

afterAll(async () => {
  await db.destroy();
});

test("the initial migration creates and seeds schema_meta", async () => {
  const row = await db
    .selectFrom("schema_meta")
    .select(["key", "value"])
    .where("key", "=", "initial_migration")
    .executeTakeFirstOrThrow();

  expect(row).toEqual({ key: "initial_migration", value: "20261025000000" });
});
