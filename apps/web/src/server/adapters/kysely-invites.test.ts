import { sql, type Kysely, type Transaction } from "kysely";
import type { DB } from "@interval/db";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createDb, kyselyInviteCodes } from "./kysely";

const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined) {
  throw new Error("DATABASE_URL is not set; copy .env.example to .env");
}
const db = createDb(connectionString);
const SHARED_PREFIX = "TESTCONC";

class Rollback extends Error {}

// Every case runs in a transaction that is rolled back; only the concurrency case,
// which needs several connections, commits and cleans up after itself.
async function rolledBack(
  body: (trx: Transaction<DB>) => Promise<void>,
): Promise<void> {
  await expect(
    db.transaction().execute(async (trx) => {
      await body(trx);
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

let counter = 0;
async function insert(
  executor: Kysely<DB>,
  opts: {
    uses?: number;
    used?: number;
    expiresInDays?: number;
    prefix?: string;
  },
): Promise<string> {
  counter += 1;
  const code = `${opts.prefix ?? "TESTCODE"}${String(Date.now()).slice(-6)}${String(counter)}`;
  await executor
    .insertInto("invite_code")
    .values({
      code,
      beta_group: "developer",
      max_uses: opts.uses ?? 1,
      used_count: opts.used ?? 0,
      expires_at: sql<Date>`now() + make_interval(days => ${opts.expiresInDays ?? 30})`,
    })
    .execute();
  return code;
}

async function usedCount(executor: Kysely<DB>, code: string): Promise<number> {
  const row = await executor
    .selectFrom("invite_code")
    .select("used_count")
    .where("code", "=", code)
    .executeTakeFirstOrThrow();
  return row.used_count;
}

async function sweep(): Promise<void> {
  await db
    .deleteFrom("invite_code")
    .where("code", "like", `${SHARED_PREFIX}%`)
    .execute();
}

beforeAll(sweep);
afterAll(async () => {
  await sweep();
  await db.destroy();
});

test("a valid code is redeemed once and returns its group", async () => {
  await rolledBack(async (trx) => {
    const codes = kyselyInviteCodes(trx);
    const code = await insert(trx, {});
    expect(await codes.redeem(code)).toMatchObject({
      ok: true,
      betaGroup: "developer",
    });
    expect(await codes.redeem(code)).toEqual({ ok: false, reason: "used_up" });
    expect(await usedCount(trx, code)).toBe(1);
  });
});

test("lower-case input with spaces and dashes is normalised", async () => {
  await rolledBack(async (trx) => {
    const code = await insert(trx, {});
    const messy = ` ${code.slice(0, 5).toLowerCase()}-${code.slice(5).toLowerCase()} `;
    expect(await kyselyInviteCodes(trx).redeem(messy)).toMatchObject({
      ok: true,
    });
  });
});

test("expired and unknown codes are refused and never consume a use", async () => {
  await rolledBack(async (trx) => {
    const codes = kyselyInviteCodes(trx);
    const expired = await insert(trx, { expiresInDays: -1 });
    expect(await codes.redeem(expired)).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(await usedCount(trx, expired)).toBe(0);
    expect(await codes.redeem("NOSUCHCODE99")).toEqual({
      ok: false,
      reason: "unknown",
    });
  });
});

test("a shared code allows exactly its number of uses", async () => {
  await rolledBack(async (trx) => {
    const codes = kyselyInviteCodes(trx);
    const code = await insert(trx, { uses: 3 });
    const results = [];
    for (let i = 0; i < 4; i += 1) results.push(await codes.redeem(code));
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(results[3]).toEqual({ ok: false, reason: "used_up" });
    expect(await usedCount(trx, code)).toBe(3);
  });
});

test("concurrent redeems of the last use let exactly one through", async () => {
  const code = await insert(db, { uses: 2, used: 1, prefix: SHARED_PREFIX });
  const codes = kyselyInviteCodes(db);
  const results = await Promise.all(
    [1, 2, 3, 4, 5].map(() => codes.redeem(code)),
  );
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(results.filter((r) => !r.ok)).toEqual(
    Array.from({ length: 4 }, () => ({ ok: false, reason: "used_up" })),
  );
  expect(await usedCount(db, code)).toBe(2);
});
