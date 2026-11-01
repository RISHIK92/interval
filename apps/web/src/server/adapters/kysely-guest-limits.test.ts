import { createHmac, randomInt } from "node:crypto";
import { sql } from "kysely";
import { afterAll, expect, test } from "vitest";
import type { GuestLimits } from "../ports";
import { createDb } from "./kysely";
import { kyselyGuestLimits, memoryGuestLimits } from "./kysely-guest-limits";

// P3-W13-S07 (owner, 2026-11-02): at most 10 guests a day from one address, which is
// kept only as a keyed hash.
const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined) throw new Error("DATABASE_URL is not set");
const db = createDb(connectionString);
const SECRET = "test-secret-test-secret-test-secret-0123";

afterAll(async () => {
  await db.destroy();
});

const randomIp = () =>
  `10.${String(randomInt(256))}.${String(randomInt(256))}.${String(randomInt(256))}`;

async function contract(
  limits: GuestLimits,
  ip: string,
  other: string,
): Promise<void> {
  // Asking counts nothing; only a guest that started does.
  for (let n = 0; n < 20; n += 1) expect(await limits.allow(ip)).toBe(true);
  for (let n = 0; n < 10; n += 1) await limits.record(ip);
  expect(await limits.allow(ip)).toBe(false);
  expect(await limits.allow(other)).toBe(true);
}

test("the in-memory fake keeps the same rule, and forgets after a day", async () => {
  let now = 0;
  const limits = memoryGuestLimits(() => now);
  await contract(limits, "203.0.113.5", "198.51.100.7");
  now = 86_400_001;
  expect(await limits.allow("203.0.113.5")).toBe(true);
});

// The adapter takes its own transaction, so this runs on the database itself, with
// addresses no one else uses, removed afterwards.
test("ten a day from one address, counted apart from others, never stored in clear", async () => {
  const limits = kyselyGuestLimits(db, SECRET);
  const [ip, other] = [randomIp(), randomIp()];
  const keys = [ip, other].map((address) =>
    createHmac("sha256", SECRET).update(`guest-ip:${address}`).digest(),
  );
  try {
    await contract(limits, ip, other);
    const rows = await db
      .selectFrom("guest_start")
      .select("ip_key")
      .where("ip_key", "in", keys)
      .execute();
    expect(rows).toHaveLength(10);
    for (const { ip_key } of rows)
      expect(Buffer.from(ip_key).toString("latin1")).not.toContain(ip);
    // Starts over a day old don't count, and are cleared at the next start.
    await db
      .updateTable("guest_start")
      .set({ created_at: sql<Date>`now() - interval '25 hours'` })
      .where("ip_key", "in", keys)
      .execute();
    expect(await limits.allow(ip)).toBe(true);
    await limits.record(ip);
    expect(
      await db
        .selectFrom("guest_start")
        .select("ip_key")
        .where("ip_key", "in", keys)
        .execute(),
    ).toHaveLength(1);
  } finally {
    await db.deleteFrom("guest_start").where("ip_key", "in", keys).execute();
  }
});
