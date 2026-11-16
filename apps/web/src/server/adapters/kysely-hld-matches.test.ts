import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { starterDesign } from "@interval/hld";
import { type Kysely, sql } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { kyselyHldMatches } from "./kysely-hld-matches";

// P6-W42 (Q-P6-03, Q-P6-06, ADR-0043): HLD matches: versions saved in order while open,
// each step (submission, closing, scoring) once.
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
      code: `HLDM${randomUUID().slice(0, 8).toUpperCase()}`,
      beta_group: "developer",
      max_uses: n,
      expires_at: sql<Date>`now() + interval '1 day'`,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const ids = Array.from({ length: n }, () => `hldm-${randomUUID()}`);
  await trx
    .insertInto("app_user")
    .values(
      ids.map((id) => ({
        id,
        name: id.slice(0, 9),
        email: `${id}@hldm.example.test`,
        beta_group: "developer" as const,
        invite_code_id: code.id,
      })),
    )
    .execute();
  return ids;
}

const variant = { family: "chat", league: "human" as const, seed: 3 };
const submission = (at: Date) => ({
  design: starterDesign(),
  simulationPoints: 40,
  baselinePassed: true,
  speedPoints: 7.5,
  judgementId: null,
  auto: false,
  at,
});

test("versions count up while the match is open and the player hasn't submitted", async () => {
  await inRollback(async (trx) => {
    const matches = kyselyHldMatches(trx);
    const [ada = "", bob = ""] = await players(trx, 2);
    const id = await matches.create([ada, bob], variant, {
      unrated: false,
      windowAt: null,
      minutes: 30,
    });
    expect(await matches.saveVersion(id, ada, starterDesign(), 0)).toBe(1);
    expect(await matches.saveVersion(id, ada, starterDesign(), 0)).toBeNull(); // stale
    expect(await matches.saveVersion(id, ada, starterDesign(), 1)).toBe(2);
    expect(
      await matches.saveVersion(id, "someone", starterDesign(), 0),
    ).toBeNull();
    expect((await matches.latestVersion(id, ada))?.version).toBe(2);
    expect(await matches.submit(id, ada, submission(new Date()))).toBe(true);
    expect(await matches.submit(id, ada, submission(new Date()))).toBe(false);
    expect(await matches.saveVersion(id, ada, starterDesign(), 2)).toBeNull(); // submitted
    expect(await matches.saveVersion(id, bob, starterDesign(), 0)).toBe(1);
    expect(await matches.unscoredFor(ada)).toEqual([id]);
  });
});

test("closing and scoring happen once; places and totals are kept", async () => {
  await inRollback(async (trx) => {
    const matches = kyselyHldMatches(trx);
    const [ada = "", bob = ""] = await players(trx, 2);
    const id = await matches.create([ada, bob], variant, {
      unrated: false,
      windowAt: null,
      minutes: 30,
    });
    const now = new Date();
    expect(
      await matches.score(
        id,
        true,
        [{ userId: ada, total: 80, place: 1 }],
        now,
      ),
    ).toBe(false); // not closed yet
    expect(await matches.close(id, now)).toBe(true);
    expect(await matches.close(id, now)).toBe(false);
    expect(await matches.saveVersion(id, bob, starterDesign(), 0)).toBeNull(); // closed
    const standings = [
      { userId: ada, total: 80, place: 1 },
      { userId: bob, total: 62.5, place: 2 },
    ];
    expect(await matches.score(id, false, standings, now)).toBe(true);
    expect(await matches.score(id, true, standings, now)).toBe(false);
    const found = await matches.get(id);
    expect(found?.match.rubricIncluded).toBe(false);
    expect(found?.seats.map((s) => [s.total, s.place])).toEqual(
      found?.seats.map((s) => (s.userId === ada ? [80, 1] : [62.5, 2])),
    );
    expect(await matches.unscoredFor(ada)).toEqual([]);
    expect(await matches.ratingOf(ada, "human")).toBe(1500);
  });
});
