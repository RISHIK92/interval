import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { type Design, practiceProblems } from "@interval/hld";
import { type Kysely, sql } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { kyselyHldPracticeDesigns } from "./kysely-hld-practice-designs";

// The first practice problem (P6-W40: each family's practice seed).
const URL_SHORTENER = (() => {
  const p = practiceProblems().find((x) => x.slug === "url-shortener");
  if (p === undefined) throw new Error("no url-shortener practice problem");
  return p;
})();

// P6-W39 (ADR-0042 PROPOSED, Q-P6-03): a practice design autosaves over the version it
// was loaded at; a stale tab's save is refused.
const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined) throw new Error("DATABASE_URL is not set");
const db = createDb(connectionString);

afterAll(async () => {
  await db.destroy();
});

class Rollback extends Error {}

async function inRollback(body: (trx: Kysely<DB>) => Promise<void>) {
  await expect(
    db.transaction().execute(async (trx) => {
      await body(trx);
      throw new Rollback();
    }),
  ).rejects.toThrow(Rollback);
}

async function player(trx: Kysely<DB>): Promise<string> {
  const code = await trx
    .insertInto("invite_code")
    .values({
      code: `HLD${randomUUID().slice(0, 8).toUpperCase()}`,
      beta_group: "developer",
      max_uses: 1,
      expires_at: sql<Date>`now() + interval '1 day'`,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const id = `hld-${randomUUID()}`;
  await trx
    .insertInto("app_user")
    .values({
      id,
      name: "Ada",
      email: `${id}@hld.example.test`,
      beta_group: "developer",
      invite_code_id: code.id,
    })
    .execute();
  return id;
}

const design = (note: string): Design => ({
  version: 1,
  spec: "1.0",
  nodes: [{ id: "users", kind: "client", config: {}, note }],
  edges: [],
});

test("saves count up from the version they were made over; a stale one is refused", async () => {
  await inRollback(async (trx) => {
    const designs = kyselyHldPracticeDesigns(trx);
    const ada = await player(trx);
    const slug = URL_SHORTENER.slug;
    expect(await designs.load(ada, slug)).toBeNull();
    expect(await designs.save(ada, slug, design("first"), 0)).toBe(1);
    // A second tab that also started from nothing.
    expect(await designs.save(ada, slug, design("other tab"), 0)).toBeNull();
    expect(await designs.save(ada, slug, design("second"), 1)).toBe(2);
    expect(await designs.save(ada, slug, design("stale"), 1)).toBeNull();
    expect(await designs.load(ada, slug)).toEqual({
      design: design("second"),
      version: 2,
    });
  });
});
