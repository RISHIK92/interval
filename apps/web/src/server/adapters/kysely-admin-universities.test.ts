import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { type Kysely, sql, type Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { kyselyAdminUniversities } from "./kysely-admin-universities";

// P3-W14-S03 (ADR-0032): the owner merges, renames or removes typed universities.
const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined) throw new Error("DATABASE_URL is not set");
const db = createDb(connectionString);

afterAll(async () => {
  await db.destroy();
});

class Rollback extends Error {}

async function account(trx: Kysely<DB>, universityId: string) {
  const code = await trx
    .insertInto("invite_code")
    .values({
      code: `LAND${randomUUID().slice(0, 8).toUpperCase()}`,
      beta_group: "developer",
      max_uses: 1,
      expires_at: sql<Date>`now() + interval '1 day'`,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const userId = `uni-admin-${randomUUID()}`;
  await trx
    .insertInto("app_user")
    .values({
      id: userId,
      name: "Ada",
      email: `${userId}@university.example.test`,
      beta_group: "developer",
      invite_code_id: code.id,
    })
    .execute();
  await trx
    .insertInto("player_university")
    .values({
      user_id: userId,
      university_id: universityId,
      changed_at: sql<Date>`now() - interval '3 days'`,
    })
    .execute();
  return userId;
}

const university = async (
  trx: Kysely<DB>,
  name: string,
  listed: boolean,
): Promise<string> =>
  (
    await trx
      .insertInto("university")
      .values({ name, listed, country: listed ? "IN" : null })
      .returning("id")
      .executeTakeFirstOrThrow()
  ).id;

const membership = (trx: Kysely<DB>, userId: string) =>
  trx
    .selectFrom("player_university")
    .select([
      "university_id",
      sql<boolean>`changed_at < now() - interval '2 days'`.as("clockKept"),
    ])
    .where("user_id", "=", userId)
    .executeTakeFirstOrThrow();

test("typed universities are listed, renamed, merged and removed; listed ones aren't touched", async () => {
  await expect(
    db.transaction().execute(async (trx: Transaction<DB>) => {
      const token = `Q${randomUUID().slice(0, 8)}`;
      const listed = await university(trx, `${token} Listed`, true);
      const big = await university(trx, `${token} Big`, false);
      const small = await university(trx, `${token} Small`, false);
      const empty = await university(trx, `${token} Empty`, false);
      const [a, b, c] = [
        await account(trx, big),
        await account(trx, big),
        await account(trx, small),
      ];
      const admin = kyselyAdminUniversities(trx);

      const mine = (await admin.typed()).filter((u) =>
        u.name.startsWith(token),
      );
      expect(mine).toEqual([
        { id: big, name: `${token} Big`, members: 2 },
        { id: small, name: `${token} Small`, members: 1 },
        { id: empty, name: `${token} Empty`, members: 0 },
      ]);

      // Listed rows come from the seed: none of these touch them.
      expect(await admin.rename(listed, "Anything")).toBe("missing");
      expect(await admin.merge(listed, big)).toBe(false);
      expect(await admin.remove(listed)).toBe(false);
      // Into itself, or into nothing.
      expect(await admin.merge(big, big)).toBe(false);
      expect(await admin.merge(big, "999999999999")).toBe(false);

      expect(await admin.rename(small, `${token} Smaller`)).toBe("renamed");
      expect(await admin.rename(small, `${token} big`)).toBe("taken");
      // A listed name too: boards would show two alike.
      expect(await admin.rename(small, `${token} LISTED`)).toBe("taken");
      expect(
        (
          await trx
            .selectFrom("university")
            .select("name")
            .where("id", "=", small)
            .executeTakeFirstOrThrow()
        ).name,
      ).toBe(`${token} Smaller`);

      // Merged: its players move with their clocks; the typed row is gone.
      expect(await admin.merge(big, listed)).toBe(true);
      for (const user of [a, b])
        expect(await membership(trx, user)).toEqual({
          university_id: listed,
          clockKept: true,
        });
      expect(await admin.merge(big, listed)).toBe(false);

      // Removed: its player has none, the clock kept.
      expect(await admin.remove(small)).toBe(true);
      expect(await membership(trx, c)).toEqual({
        university_id: null,
        clockKept: true,
      });
      expect(await admin.rename(small, "Gone")).toBe("missing");
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
});
