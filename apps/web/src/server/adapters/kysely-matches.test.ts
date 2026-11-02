import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { sql, type Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import type { Matches } from "../ports";
import { createDb } from "./kysely";
import { kyselyMatches, memoryMatches } from "./kysely-matches";
import { LIVE_ROUNDS, type LiveRound } from "../ports";

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
  expect(await matches.serverFor(id, a)).toEqual({ serverId: 0, playedAs: a });
  expect(await matches.serverFor(id, b)).toEqual({ serverId: 0, playedAs: b });
  // Not theirs, or no such match.
  expect(await matches.serverFor(id, c)).toBeNull();
  expect(await matches.serverFor(randomUUID(), a)).toBeNull();
  const other = await make(3, [c]);
  expect(await matches.serverFor(other, c)).toEqual({
    serverId: 3,
    playedAs: c,
  });
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

// P3-W15-S03 (Q-P3-22): a match of seven live multiple-choice questions, recorded.
const choices = (n: number): LiveRound[] =>
  Array.from({ length: n }, (_, i) => ({
    question: String(i + 1),
    stem: `Q${String(i)}?`,
    options: ["a", "b", "c", "d"],
    correct: i % 4,
  }));

test("the fake makes a match of seven, or none from a smaller bank", async () => {
  const all = new Map<string, { serverId: number; players: string[] }>();
  const made = await memoryMatches(all, choices(9)).create(0, ["a", "b"]);
  expect(made?.rounds).toHaveLength(LIVE_ROUNDS);
  expect(made?.players).toEqual(["a", "b"]);
  expect(await memoryMatches(all).serverFor(made?.id ?? "", "a")).toEqual({
    serverId: 0,
    playedAs: "a",
  });
  expect(
    await memoryMatches(new Map(), choices(6)).create(0, ["a"]),
  ).toBeNull();
});

test("Postgres picks seven different live questions and records them in order", async () => {
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
      const players = [0, 1].map(() => `match-${randomUUID()}`);
      await trx
        .insertInto("app_user")
        .values(
          players.map((id) => ({
            id,
            name: "Ada",
            email: `${id}@match.example.test`,
            beta_group: "developer" as const,
            invite_code_id: code.id,
          })),
        )
        .execute();
      // A bank of eight live questions the rights allow (other live ones may exist).
      const source = await trx
        .insertInto("source")
        .values({
          name: `live-${randomUUID()}`,
          feed_url: `https://live.example.test/${randomUUID()}.xml`,
          rights_profile: "full_text_internal",
          moments_seeded: true,
          moments_enabled: true,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const item = await trx
        .insertInto("content_item")
        .values({
          source_id: source.id,
          guid: randomUUID(),
          canonical_url: `https://live.example.test/${randomUUID()}`,
          title: "Consensus",
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      for (let m = 0; m < 4; m += 1) {
        const moment = await trx
          .insertInto("moment")
          .values({
            content_item_id: item.id,
            ordinal: m,
            title: `M${String(m)}`,
            estimated_minutes: 3,
            link: `https://live.example.test/post#m${String(m)}`,
            link_type: "anchor",
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        for (const ordinal of [0, 1])
          await trx
            .insertInto("question")
            .values({
              moment_id: moment.id,
              ordinal,
              stem: `Which ${String(m)}.${String(ordinal)}?`,
              options: ["right", "w1", "w2", "w3"],
              correct: 0,
              citation: "a b c",
              status: "live",
              generator_model: "m",
              prompt_version: 1,
              content_hash: "h",
            })
            .execute();
      }
      const matches = kyselyMatches(trx);
      const made = await matches.create(2, players);
      if (made === null) throw new Error("no match");
      expect(made.serverId).toBe(2);
      expect(made.players).toEqual(players);
      expect(made.rounds).toHaveLength(LIVE_ROUNDS);
      expect(new Set(made.rounds.map((r) => r.question)).size).toBe(
        LIVE_ROUNDS,
      );
      for (const r of made.rounds) {
        expect(r.options).toHaveLength(4);
        expect(r.correct).toBeGreaterThanOrEqual(0);
        expect(r.correct).toBeLessThan(4);
      }
      const recorded = await trx
        .selectFrom("game_match_question")
        .select(["round", "question_id"])
        .where("match_id", "=", made.id)
        .orderBy("round")
        .execute();
      expect(recorded).toEqual(
        made.rounds.map((r, i) => ({ round: i + 1, question_id: r.question })),
      );
      expect(await matches.serverFor(made.id, players[1] ?? "")).toEqual({
        serverId: 2,
        playedAs: players[1],
      });
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
});
