import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import { afterAll, expect, test } from "vitest";
import { createDb } from "./kysely";
import { kyselyBattleQuestions } from "./kysely-battle-questions";

// P5-W33 (§6.2, Q-P5-13): a player asks in their open AI-league battle, at most 10 times.
const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined) throw new Error("DATABASE_URL is not set");
const db = createDb(connectionString);

afterAll(async () => {
  await db.destroy();
});

class Rollback extends Error {}

test("only a player of an open AI-league battle asks, and only 10 times", async () => {
  await expect(
    db.transaction().execute(async (trx: Kysely<DB>) => {
      const code = await trx
        .insertInto("invite_code")
        .values({
          code: `ASK${randomUUID().slice(0, 8).toUpperCase()}`,
          beta_group: "developer",
          max_uses: 2,
          expires_at: sql<Date>`now() + interval '1 day'`,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const [ada, bob] = [1, 2].map(() => `ask-${randomUUID()}`) as [
        string,
        string,
      ];
      await trx
        .insertInto("app_user")
        .values(
          [ada, bob].map((id) => ({
            id,
            name: id,
            email: `${id}@ask.example.test`,
            beta_group: "developer" as const,
            invite_code_id: code.id,
          })),
        )
        .execute();
      const slug = `ask-${randomUUID().slice(0, 8)}`;
      const hash = "c".repeat(64);
      await trx
        .insertInto("lld_problem")
        .values({
          slug,
          title: "A problem",
          difficulty: "easy",
          statement: "# A",
          interface: JSON.stringify({}),
          limits: JSON.stringify({}),
          visible: JSON.stringify([]),
          private_key: `lld/problems/${slug}/${hash}.json`,
          content_hash: hash,
          league: "ai",
          interviewer_notes: "Values are never null.",
        })
        .execute();
      const battle = async (league: "human" | "ai") => {
        const { id } = await trx
          .insertInto("game_match")
          .values({ server_id: 0, mode: "battle", problem_slug: slug, league })
          .returning("id")
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("game_match_player")
          .values({ match_id: id, user_id: ada })
          .execute();
        return id;
      };
      const ai = await battle("ai");
      const human = await battle("human");
      const questions = kyselyBattleQuestions(trx);
      expect(await questions.ask(human, ada, "Null?")).toBeNull();
      expect(await questions.ask(ai, bob, "Null?")).toBeNull();
      for (let i = 0; i < 10; i++)
        expect(await questions.ask(ai, ada, `Q${String(i)}?`)).toMatchObject({
          id: expect.stringMatching(/^\d+$/) as unknown,
        });
      expect(await questions.ask(ai, ada, "One more?")).toBe("limit");
      const listed = await questions.list(ai, ada);
      expect(listed).toHaveLength(10);
      expect(listed[0]).toMatchObject({
        question: "Q0?",
        status: "pending",
        answer: null,
      });
      throw new Rollback();
    }),
  ).rejects.toThrow(Rollback);
});
