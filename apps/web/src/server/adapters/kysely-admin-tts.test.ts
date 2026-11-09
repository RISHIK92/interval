import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { sql, type Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { kyselyAdminTts } from "./kysely-admin-tts";

// P4-W22-S03 (TTS-1): the blind test's latest run; providers hidden until every script
// has a pick, one pick a script.
const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined) {
  throw new Error("DATABASE_URL is not set; copy .env.example to .env");
}
const db = createDb(connectionString);

afterAll(async () => {
  await db.destroy();
});

class Rollback extends Error {}

async function inRollback(
  body: (trx: Transaction<DB>, admin: string, run: string) => Promise<void>,
): Promise<void> {
  await expect(
    db.transaction().execute(async (trx) => {
      const code = await trx
        .insertInto("invite_code")
        .values({
          code: `TTST${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
          beta_group: "student",
          max_uses: 1,
          expires_at: sql<Date>`now() + interval '1 day'`,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const admin = randomUUID();
      await trx
        .insertInto("app_user")
        .values({
          id: admin,
          name: "n",
          email: `${admin}@example.test`,
          beta_group: "student",
          invite_code_id: code.id,
        })
        .execute();
      const run = randomUUID();
      // A complete run: five scripts, each said by both providers.
      for (let n = 1; n <= 5; n++)
        for (const [label, provider] of [
          ["A", n % 2 === 0 ? "elevenlabs" : "inworld"],
          ["B", n % 2 === 0 ? "inworld" : "elevenlabs"],
        ] as const)
          await trx
            .insertInto("tts_sample")
            .values({
              run,
              script_no: n,
              voice_label: label,
              provider,
              file_key: `tts-blind/${run}/${String(n)}-${label}.mp3`,
              created_at: sql<Date>`now() + interval '1 hour'`,
            })
            .execute();
      await body(trx, admin, run);
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

test("voices stay unnamed until every script has a pick, then the tally", async () => {
  await inRollback(async (trx, admin, run) => {
    const store = kyselyAdminTts(trx);
    const before = await store.latest();
    expect(before?.run).toBe(run);
    expect(before?.revealed).toBe(false);
    expect(before?.newerStopped).toBe(false);
    expect(
      before?.scripts.flatMap((s) => s.voices.map((v) => v.provider)),
    ).toEqual(Array.from({ length: 10 }, () => null));
    const voice = (n: number, label: string) => {
      const found = before?.scripts
        .find((s) => s.scriptNo === n)
        ?.voices.find((v) => v.label === label);
      if (found === undefined) throw new Error("seeded");
      return found.id;
    };
    expect(await store.pick(voice(1, "B"), admin)).toBe(true);
    // One pick a script: a second is refused, not moved.
    expect(await store.pick(voice(1, "A"), admin)).toBe(false);
    for (const n of [2, 3, 4])
      expect(await store.pick(voice(n, "A"), admin)).toBe(true);
    // Four of five: still unnamed.
    expect((await store.latest())?.revealed).toBe(false);
    expect(await store.pick(voice(5, "A"), admin)).toBe(true);
    const after = await store.latest();
    expect(after?.revealed).toBe(true);
    expect(after?.scripts[0]?.voices).toEqual([
      expect.objectContaining({
        label: "A",
        provider: "inworld",
        picked: false,
      }),
      expect.objectContaining({
        label: "B",
        provider: "elevenlabs",
        picked: true,
      }),
    ]);
    // Picks: script 1 B (elevenlabs), 2 A (elevenlabs), 3 A (inworld), 4 A
    // (elevenlabs), 5 A (inworld).
    expect(after?.tally).toEqual([
      { provider: "elevenlabs", picks: 3 },
      { provider: "inworld", picks: 2 },
    ]);
    expect(await store.fileKey(voice(2, "A"))).toBe(`tts-blind/${run}/2-A.mp3`);
  });
});

test("a newer run that stopped part way is passed over, and said", async () => {
  await inRollback(async (trx, _admin, run) => {
    const stopped = randomUUID();
    await trx
      .insertInto("tts_sample")
      .values({
        run: stopped,
        script_no: 1,
        voice_label: "A",
        provider: "polly",
        file_key: `tts-blind/${stopped}/1-A.mp3`,
        created_at: sql<Date>`now() + interval '2 hours'`,
      })
      .execute();
    const shown = await kyselyAdminTts(trx).latest();
    expect(shown?.run).toBe(run);
    expect(shown?.newerStopped).toBe(true);
  });
});
