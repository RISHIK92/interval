import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { kyselyHldMatches } from "./kysely-hld-matches";
import { kyselyHldTournaments } from "./kysely-hld-tournaments";

// P6-W43 (§6.4, HLDQ-3, Q-P6-07): tournaments: their problems retired as they're made,
// registration until the first round, check-in in the hour before, rounds started once,
// pairings in their order.
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

async function players(trx: Kysely<DB>, n: number): Promise<string[]> {
  const code = await trx
    .insertInto("invite_code")
    .values({
      code: `HLDT${randomUUID().slice(0, 8).toUpperCase()}`,
      beta_group: "developer",
      max_uses: n,
      expires_at: sql<Date>`now() + interval '1 day'`,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const ids = Array.from({ length: n }, () => `hldt-${randomUUID()}`);
  await trx
    .insertInto("app_user")
    .values(
      ids.map((id) => ({
        id,
        name: id.slice(0, 9),
        email: `${id}@hldt.example.test`,
        beta_group: "developer" as const,
        invite_code_id: code.id,
      })),
    )
    .execute();
  return ids;
}

const rounds = Array.from({ length: 8 }, (_, i) => ({
  family: "chat",
  seed: 1000 + i,
}));

test("made with its problems retired; entered, checked in, and started round by round", async () => {
  await inRollback(async (trx) => {
    const tournaments = kyselyHldTournaments(trx);
    const [owner = "", ada = "", bob = ""] = await players(trx, 3);
    const startsAt = new Date("2030-06-01T18:00:00Z");
    const id = await tournaments.create(
      { name: "Practice Cup", battleMode: "human", startsAt, rounds },
      owner,
    );
    // Other tournaments in the database may have retired variants too: only ours count.
    const retired = await kyselyHldMatches(trx).retired("human");
    for (const r of rounds)
      expect(retired.has(`chat/${String(r.seed)}`)).toBe(true);
    expect(await tournaments.register(id, ada)).toBe(true);
    expect(await tournaments.register(id, bob)).toBe(true);
    const early = new Date(startsAt.getTime() - 2 * 3600_000);
    const inTime = new Date(startsAt.getTime() - 30 * 60_000);
    expect(await tournaments.checkIn(id, ada, early)).toBe("not_open");
    expect(await tournaments.checkIn(id, ada, inTime)).toBe("checked_in");
    expect(await tournaments.checkIn(id, owner, inTime)).toBe("not_registered");
    expect(
      (await tournaments.entries(id))
        .map((e) => [e.userId, e.checkedIn])
        .sort(),
    ).toEqual(
      [
        [ada, true],
        [bob, false],
      ].sort(),
    );
    const pairs = [
      { round: 1, slot: 1, playerA: bob, playerB: null, matchId: null },
      { round: 1, slot: 0, playerA: ada, playerB: owner, matchId: null },
    ];
    expect(await tournaments.claimRound(id, 0, 1, pairs)).toBe(true);
    expect(await tournaments.claimRound(id, 0, 1, pairs)).toBe(false);
    expect(await tournaments.register(id, owner)).toBe(false); // started
    expect((await tournaments.pairings(id)).map((p) => p.playerA)).toEqual([
      ada,
      bob,
    ]);
    const match = await kyselyHldMatches(trx).create(
      [ada, owner],
      { family: "chat", battleMode: "human", seed: 3 },
      { unrated: true, windowAt: null, minutes: 30 },
    );
    expect(await tournaments.setMatch(id, 1, 0, match)).toBe(true);
    expect(await tournaments.setMatch(id, 1, 0, match)).toBe(false);
    expect(await tournaments.setMatch(id, 1, 1, match)).toBe(false); // a bye has none
    // P6-W44: the round a match was played in, and whether it's over.
    expect(await tournaments.roundOf(match)).toEqual({
      players: expect.arrayContaining([ada, owner, bob]) as string[],
      over: false,
    });
    await trx
      .updateTable("hld_match")
      .set({ closed_at: new Date() })
      .where("id", "=", match)
      .execute();
    expect((await tournaments.roundOf(match))?.over).toBe(true);
    await kyselyHldMatches(trx).saveVersion(
      match,
      ada,
      {
        version: 1,
        spec: "1.0",
        nodes: [{ id: "users", kind: "client", config: {}, note: "" }],
        edges: [],
      },
      0,
    );
    expect((await tournaments.get(id))?.round).toBe(1);
    expect(await tournaments.finish(id, new Date())).toBe(true);
    expect(await tournaments.finish(id, new Date())).toBe(false);
  });
});
