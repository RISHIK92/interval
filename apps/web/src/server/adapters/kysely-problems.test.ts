import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import type { Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import type { LoadedProblem } from "../ports";
import { createDb } from "./kysely";
import { kyselyProblemStore } from "./kysely-problems";

// P5-W31-S01 (LLDQ-4): the problem store against Postgres, in a rolled-back transaction.
const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined) {
  throw new Error("DATABASE_URL is not set; copy .env.example to .env");
}
const db = createDb(connectionString);
afterAll(async () => {
  await db.destroy();
});

class Rollback extends Error {}

async function inRollback(body: (trx: Transaction<DB>) => Promise<void>) {
  await expect(
    db.transaction().execute(async (trx) => {
      await body(trx);
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

const hash = (c: string) => c.repeat(64);
const problem = (slug: string, h: string): LoadedProblem => ({
  slug,
  title: "A problem",
  difficulty: "easy",
  league: "human",
  statement: "# A problem",
  interface: {
    class: "Box",
    constructor: { params: [] },
    methods: [{ name: "size", params: [], returns: "int" }],
  },
  checks: [],
  limits: { seconds: 5, memoryMB: 128 },
  visible: [
    { scenario: { calls: [{ method: "new", args: [] }] }, results: [] },
  ],
  extension: null,
  privateKey: `lld/problems/${slug}/${h}.json`,
  contentHash: h,
});

test("saves, replaces and retires problems by slug", async () => {
  await inRollback(async (trx) => {
    const store = kyselyProblemStore(trx);
    const a = `p-${randomUUID().slice(0, 8)}`;
    const b = `p-${randomUUID().slice(0, 8)}`;
    await store.save(problem(a, hash("a")));
    await store.save(problem(b, hash("b")));
    await store.save(problem(a, hash("c")));
    let live = await store.hashes();
    expect(live.get(a)).toBe(hash("c"));
    expect(live.get(b)).toBe(hash("b"));
    const row = await trx
      .selectFrom("lld_problem")
      .select(["visible", "interface"])
      .where("slug", "=", a)
      .executeTakeFirstOrThrow();
    expect(row.visible).toEqual(problem(a, hash("c")).visible);
    await store.retire([b]);
    live = await store.hashes();
    expect(live.has(b)).toBe(false);
    // Loaded again, it is live again.
    await store.save(problem(b, hash("b")));
    expect((await store.hashes()).has(b)).toBe(true);
  });
});

test("the schema refuses a bad slug or a private key that isn't content-addressed", async () => {
  for (const bad of [
    {
      ...problem("Bad_Slug", hash("a")),
      privateKey: `lld/problems/x/${hash("a")}.json`,
    },
    { ...problem("ok-slug", hash("a")), privateKey: "elsewhere.json" },
  ])
    await inRollback(async (trx) => {
      await expect(kyselyProblemStore(trx).save(bad)).rejects.toThrow(
        /check constraint/,
      );
    });
});

// P5-W31-S02a: an extension's statement and interface are stored together, and cleared
// together when a reload drops the extension.
test("stores an extension's statement and interface, and clears both", async () => {
  await inRollback(async (trx) => {
    const store = kyselyProblemStore(trx);
    const slug = `p-${randomUUID().slice(0, 8)}`;
    const extended = {
      ...problem(slug, hash("a")),
      extension: {
        statement: "# More",
        interface: {
          class: "Box",
          constructor: { params: [] },
          methods: [{ name: "size", params: [], returns: "int" }],
        },
      },
    };
    await store.save(extended);
    const read = () =>
      trx
        .selectFrom("lld_problem")
        .select(["extension_statement", "extension_interface"])
        .where("slug", "=", slug)
        .executeTakeFirstOrThrow();
    expect(await read()).toEqual({
      extension_statement: "# More",
      extension_interface: extended.extension.interface,
    });
    await store.save(problem(slug, hash("b")));
    expect(await read()).toEqual({
      extension_statement: null,
      extension_interface: null,
    });
  });
});

// P5-W31-S02b: a live problem as saved, for a battle's definition; none once retired.
test("gets a live problem as it was saved", async () => {
  await inRollback(async (trx) => {
    const store = kyselyProblemStore(trx);
    const slug = `p-${randomUUID().slice(0, 8)}`;
    const saved = {
      ...problem(slug, hash("a")),
      extension: {
        statement: "# More",
        interface: {
          class: "Box",
          constructor: { params: [] },
          methods: [{ name: "size", params: [], returns: "int" }],
        },
      },
    };
    await store.save(saved);
    expect(await store.get(slug)).toEqual(saved);
    expect(await store.get("no-such-problem")).toBeNull();
    await store.retire([slug]);
    expect(await store.get(slug)).toBeNull();
  });
});
