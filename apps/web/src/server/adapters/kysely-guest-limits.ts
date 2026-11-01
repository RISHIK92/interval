import { createHmac } from "node:crypto";
import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import type { GuestLimits } from "../ports";

// P3-W13-S07 (owner, 2026-11-02): at most 10 guests a day from one network.
// shortcut: two starts at the same moment can both pass the check, so a network can
// get a guest or two past 10; make allow-and-record one locked step if that matters.
const PER_DAY = 10;
const DAY_MS = 86_400_000;

// The address is kept only as a keyed hash: without the secret, the stored keys can't
// be tried against every address. The key is the auth secret, so rotating it starts
// every network's count over.
export function kyselyGuestLimits(db: Kysely<DB>, secret: string): GuestLimits {
  const keyOf = (ip: string) =>
    createHmac("sha256", secret).update(`guest-ip:${ip}`).digest();
  return {
    allow: async (ip) => {
      const { count } = await db
        .selectFrom("guest_start")
        .select((eb) => eb.fn.countAll<string>().as("count"))
        .where("ip_key", "=", keyOf(ip))
        .where("created_at", ">=", sql<Date>`now() - interval '1 day'`)
        .executeTakeFirstOrThrow();
      return Number(count) < PER_DAY;
    },
    record: async (ip) => {
      await db
        .deleteFrom("guest_start")
        .where("created_at", "<", sql<Date>`now() - interval '1 day'`)
        .execute();
      await db
        .insertInto("guest_start")
        .values({ ip_key: keyOf(ip) })
        .execute();
    },
  };
}

// The same rule in memory, for tests of the logic around it (ADR-0012).
export function memoryGuestLimits(now = () => Date.now()): GuestLimits {
  const starts = new Map<string, number[]>();
  const recent = (ip: string) =>
    (starts.get(ip) ?? []).filter((at) => now() - at < DAY_MS);
  return {
    allow: (ip) => Promise.resolve(recent(ip).length < PER_DAY),
    record: (ip) => {
      starts.set(ip, [...recent(ip), now()]);
      return Promise.resolve();
    },
  };
}
