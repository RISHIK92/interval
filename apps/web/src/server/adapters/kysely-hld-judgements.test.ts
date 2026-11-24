import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { calibrationCandidates, type JudgeInput } from "@interval/hld";
import { type Kysely, sql } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { kyselyHldJudgements } from "./kysely-hld-judgements";

// P6-W41 (CANVAS-6, Q-P6-05): judgements on request (one waiting at a time), one appeal
// each within 7 days, resolved by the owner; and the calibration grades.
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
      code: `JDG${randomUUID().slice(0, 8).toUpperCase()}`,
      beta_group: "developer",
      max_uses: 1,
      expires_at: sql<Date>`now() + interval '1 day'`,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const id = `jdg-${randomUUID()}`;
  await trx
    .insertInto("app_user")
    .values({
      id,
      name: "Ada",
      email: `${id}@jdg.example.test`,
      beta_group: "developer",
      invite_code_id: code.id,
    })
    .execute();
  return id;
}

const input: JudgeInput = (() => {
  const c = calibrationCandidates()[0];
  if (c === undefined) throw new Error("no calibration candidates");
  return c.input;
})();
const levels = { caching: { level: 3, reason: "Sound." } };

test("one request waits at a time; a dropped one can be asked again", async () => {
  await inRollback(async (trx) => {
    const judgements = kyselyHldJudgements(trx);
    const ada = await player(trx);
    const first = await judgements.request(
      ada,
      "url-shortener",
      input,
      true,
      null,
    );
    expect(first.created).toBe(true);
    expect(
      await judgements.request(ada, "url-shortener", input, true, null),
    ).toEqual({
      id: first.id,
      created: false,
    });
    await judgements.drop(first.id);
    expect(
      (await judgements.request(ada, "url-shortener", input, true, null))
        .created,
    ).toBe(true);
    expect((await judgements.latest(ada, "url-shortener"))?.status).toBe(
      "pending",
    );
  });
});

test("the same design again gets its feedback; a lost request stops blocking", async () => {
  await inRollback(async (trx) => {
    const judgements = kyselyHldJudgements(trx);
    const ada = await player(trx);
    const first = await judgements.request(
      ada,
      "url-shortener",
      input,
      true,
      null,
    );
    await trx
      .updateTable("hld_judgement")
      .set({
        status: "ready",
        levels: JSON.stringify(levels),
        judged_at: new Date(),
      })
      .where("id", "=", first.id)
      .execute();
    expect(
      await judgements.request(ada, "url-shortener", input, true, null),
    ).toEqual({
      id: first.id,
      created: false,
    });
    const changed = { ...input, title: "Changed" };
    const second = await judgements.request(
      ada,
      "url-shortener",
      changed,
      true,
      null,
    );
    expect(second.created).toBe(true);
    await trx
      .updateTable("hld_judgement")
      .set({ requested_at: sql<Date>`now() - interval '1 hour'` })
      .where("id", "=", second.id)
      .execute();
    const third = await judgements.request(
      ada,
      "url-shortener",
      { ...input, title: "Again" },
      true,
      null,
    );
    expect(third.created).toBe(true);
    expect((await judgements.get(second.id, ada))?.status).toBe("unavailable");
  });
});

test("an appeal: once, within 7 days, of a judged design; the owner's levels replace the judge's", async () => {
  await inRollback(async (trx) => {
    const judgements = kyselyHldJudgements(trx);
    const ada = await player(trx);
    const { id } = await judgements.request(
      ada,
      "url-shortener",
      input,
      true,
      null,
    );
    const now = new Date();
    expect(await judgements.appeal(id, ada, "Too low.", now)).toBe(
      "not_judged",
    );
    await trx
      .updateTable("hld_judgement")
      .set({ status: "ready", levels: JSON.stringify(levels), judged_at: now })
      .where("id", "=", id)
      .execute();
    expect(await judgements.appeal(id, "someone-else", "x", now)).toBeNull();
    const late = new Date(now.getTime() + 8 * 24 * 3600 * 1000);
    expect(await judgements.appeal(id, ada, "Too low.", late)).toBe("late");
    expect(await judgements.appeal(id, ada, "Too low.", now)).toBe("appealed");
    expect(await judgements.appeal(id, ada, "Again.", now)).toBe("twice");

    const [open] = (await judgements.openAppeals()).filter((a) => a.id === id);
    expect(open).toMatchObject({ player: "Ada", reason: "Too low.", levels });
    expect(open?.input).toEqual(input);
    const owner = {
      caching: { level: 4, reason: "Owner: the invalidation is right." },
    };
    expect(await judgements.resolve(id, owner, ada)).toBe(true);
    expect(await judgements.resolve(id, owner, ada)).toBe(false);
    expect((await judgements.get(id, ada))?.ownerLevels).toEqual(owner);
    expect((await judgements.openAppeals()).some((a) => a.id === id)).toBe(
      false,
    );
    // Practice feedback isn't a result: only a match's judgements count toward the rate.
    const before = await judgements.appealRate(now);
    const match = await trx
      .insertInto("hld_match")
      .values({
        family: "chat",
        battle_mode: "human",
        seed: 3,
        spec: "1.0",
        deadline_at: sql<Date>`now() + interval '30 minutes'`,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .updateTable("hld_judgement")
      .set({ match_id: match.id })
      .where("id", "=", id)
      .execute();
    expect(await judgements.appealRate(now)).toEqual({
      appealed: before.appealed + 1,
      judged: before.judged + 1,
    });
  });
});

test("calibration grades are kept per candidate and criterion, the latest winning", async () => {
  await inRollback(async (trx) => {
    const judgements = kyselyHldJudgements(trx);
    const owner = await player(trx);
    await judgements.grade(
      "url-shortener/reference",
      { caching: 3, codes: 2 },
      owner,
    );
    await judgements.grade("url-shortener/reference", { caching: 4 }, owner);
    expect(
      (await judgements.calibrationGrades()).get("url-shortener/reference"),
    ).toEqual({
      caching: 4,
      codes: 2,
    });
  });
});
