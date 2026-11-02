import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { sql, type Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import type { Matches } from "../ports";
import { createDb } from "./kysely";
import { kyselyMatches, memoryMatches } from "./kysely-matches";

// P3-W15-S02 (ADR-0033): a ticket is issued only to a player of the match.
const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined) throw new Error("DATABASE_URL is not set");
const db = createDb(connectionString);

afterAll(async () => {
  await db.destroy();
});

// `make` adds a match on a server with its players and returns its id.
async function contract(
  matches: Matches,
  make: (serverId: number, players: string[]) => Promise<string>,
  [a, b, c]: [string, string, string],
): Promise<void> {
  const id = await make(0, [a, b]);
  expect(await matches.serverFor(id, a)).toBe(0);
  expect(await matches.serverFor(id, b)).toBe(0);
  // Not theirs, or no such match.
  expect(await matches.serverFor(id, c)).toBeNull();
  expect(await matches.serverFor(randomUUID(), a)).toBeNull();
  const other = await make(3, [c]);
  expect(await matches.serverFor(other, c)).toBe(3);
}

test("the in-memory fake keeps the contract", async () => {
  const all = new Map<string, { serverId: number; players: string[] }>();
  await contract(
    memoryMatches(all),
    (serverId, players) => {
      const id = randomUUID();
      all.set(id, { serverId, players });
      return Promise.resolve(id);
    },
    ["a", "b", "c"],
  );
});

class Rollback extends Error {}

test("the Postgres adapter keeps the contract", async () => {
  await expect(
    db.transaction().execute(async (trx: Transaction<DB>) => {
      const code = await trx
        .insertInto("invite_code")
        .values({
          code: `MATCH${randomUUID().slice(0, 8).toUpperCase()}`,
          beta_group: "developer",
          max_uses: 10,
          expires_at: sql<Date>`now() + interval '1 day'`,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const ids = [0, 1, 2].map(() => `match-${randomUUID()}`);
      await trx
        .insertInto("app_user")
        .values(
          ids.map((id, i) => ({
            id,
            name: "Ada",
            email: `${id}@match.example.test`,
            // A guest plays too (ADR-0029).
            is_anonymous: i === 1,
            beta_group: "developer" as const,
            invite_code_id: code.id,
          })),
        )
        .execute();
      // The rows `pnpm game:match` (scripts/match-create.ts) writes.
      await contract(
        kyselyMatches(trx),
        async (serverId, players) => {
          const { id } = await trx
            .insertInto("game_match")
            .values({ server_id: serverId })
            .returning("id")
            .executeTakeFirstOrThrow();
          await trx
            .insertInto("game_match_player")
            .values(players.map((user_id) => ({ match_id: id, user_id })))
            .execute();
          return id;
        },
        ids as [string, string, string],
      );
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
});
