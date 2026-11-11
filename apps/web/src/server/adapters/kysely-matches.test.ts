import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { sql, type Transaction } from "kysely";
import { afterAll, expect, test } from "vitest";
import type { Matches } from "../ports";
import { createDb } from "./kysely";
import { kyselyMatches, memoryMatches } from "./kysely-matches";
import { seedLiveQuestions } from "./live-bank.fixture";
import { LIVE_QUESTIONS, type LiveRound } from "../ports";

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
    ai: true,
  }));

test("the fake makes a match of seven, or none from a smaller bank", async () => {
  const all = new Map<string, { serverId: number; players: string[] }>();
  const made = await memoryMatches(all, choices(9)).create(
    0,
    ["a", "b"],
    "fastest_finger",
  );
  expect(made?.rounds).toHaveLength(LIVE_QUESTIONS.fastest_finger);
  expect(made?.mode).toBe("fastest_finger");
  expect(made?.players).toEqual(["a", "b"]);
  expect(await memoryMatches(all).serverFor(made?.id ?? "", "a")).toEqual({
    serverId: 0,
    playedAs: "a",
  });
  expect(
    await memoryMatches(new Map(), choices(6)).create(
      0,
      ["a"],
      "fastest_finger",
    ),
  ).toBeNull();
  // Q-P3-23: a sprint plays 30.
  expect(
    await memoryMatches(new Map(), choices(29)).create(0, ["a"], "sprint"),
  ).toBeNull();
  expect(
    (await memoryMatches(new Map(), choices(31)).create(0, ["a"], "sprint"))
      ?.rounds,
  ).toHaveLength(LIVE_QUESTIONS.sprint);
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
      // MATCH-4 (P3-W16-S03): both have evidence on one concept, which these test.
      const { id: sharedConcept } = await trx
        .insertInto("concept")
        .values({
          slug: `live-${randomUUID()}`,
          name: "Shared",
          topic: "databases",
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("concept_mastery")
        .values(
          players.map((user_id) => ({
            user_id,
            concept_id: sharedConcept,
            probability: 0.3,
            state: "explored" as const,
            evidence_count: 1,
          })),
        )
        .execute();
      const ours: string[] = [];
      // Enough for a sprint (two a section) without anyone else's questions.
      for (let m = 0; m < LIVE_QUESTIONS.sprint / 2; m += 1) {
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
            .returning("id")
            .executeTakeFirstOrThrow()
            .then(async ({ id }) => {
              ours.push(id);
              await trx
                .insertInto("question_concept")
                .values({ question_id: id, concept_id: sharedConcept })
                .execute();
            });
      }
      const matches = kyselyMatches(trx);
      const made = await matches.create(2, players, "fastest_finger");
      if (made === null) throw new Error("no match");
      expect(made.serverId).toBe(2);
      expect(made.players).toEqual(players);
      expect(made.rounds).toHaveLength(LIVE_QUESTIONS.fastest_finger);
      expect(new Set(made.rounds.map((r) => r.question)).size).toBe(
        LIVE_QUESTIONS.fastest_finger,
      );
      // Of the whole local bank, the shared concept's questions come first.
      for (const r of made.rounds) expect(ours).toContain(r.question);
      for (const r of made.rounds) {
        expect(r.options).toHaveLength(4);
        expect(r.correct).toBeGreaterThanOrEqual(0);
        expect(r.correct).toBeLessThan(4);
        // ADR-0037: drafted by a model (generator_model set), so labeled.
        expect(r.ai).toBe(true);
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
      // P3-W17-S03: a friend challenge is kept unrated; an ordinary match isn't.
      const friendly = await matches.create(2, players, "fastest_finger", {
        unrated: true,
      });
      expect(
        await trx
          .selectFrom("game_match")
          .select(["id", "unrated"])
          .where("id", "in", [made.id, friendly?.id ?? ""])
          .orderBy("unrated")
          .execute(),
      ).toEqual([
        { id: made.id, unrated: false },
        { id: friendly?.id, unrated: true },
      ]);
      // Q-P3-23: a sprint's 30 questions, distinct, recorded with its mode.
      const sprint = await matches.create(2, players, "sprint");
      if (sprint === null) throw new Error("no sprint");
      expect(sprint.mode).toBe("sprint");
      expect(new Set(sprint.rounds.map((r) => r.question)).size).toBe(
        LIVE_QUESTIONS.sprint,
      );
      expect(
        await trx
          .selectFrom("game_match")
          .select(["id", "mode"])
          .where("id", "in", [made.id, sprint.id])
          .orderBy("mode")
          .execute(),
      ).toEqual([
        { id: made.id, mode: "fastest_finger" },
        { id: sprint.id, mode: "sprint" },
      ]);
      expect(
        await trx
          .selectFrom("game_match_question")
          .select((eb) => eb.fn.max("round").as("last"))
          .where("match_id", "=", sprint.id)
          .executeTakeFirst(),
      ).toEqual({ last: 30 });
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
});

// P3-W16-S03 (MATCH-4, Q-P3-15) on Postgres: a retired concept both know isn't shared;
// a goal concept (user_goal_concepts) fills in; two players rated over 1700 play
// advanced questions first.
test("Postgres: retired concepts never count, goal concepts fill, the pair's level first", async () => {
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
      const concept = async (retired: boolean) => {
        const slug = `tier-${randomUUID()}`;
        const { id } = await trx
          .insertInto("concept")
          .values({
            slug,
            name: slug,
            topic: "databases",
            retired_at: retired ? sql<Date>`now()` : null,
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        return { id, slug };
      };
      const retired = await concept(true);
      const goal = await concept(false);
      // Both "know" the retired concept: it must not make its questions shared.
      await trx
        .insertInto("concept_mastery")
        .values(
          players.map((user_id) => ({
            user_id,
            concept_id: retired.id,
            probability: 0.3,
            state: "explored" as const,
            evidence_count: 1,
          })),
        )
        .execute();
      // One player's goal (stay-sharp) leads to the goal concept.
      await trx
        .insertInto("goal_concept")
        .values({ goal: "stay-sharp", concept_slug: goal.slug })
        .execute();
      await trx
        .insertInto("user_preferences")
        .values({
          user_id: players[0] ?? "",
          topics: ["databases"],
          level: "intermediate",
          break_length: "3-8",
          goals: ["stay-sharp"],
        })
        .execute();
      // Both rated over 1700: advanced.
      await trx
        .insertInto("player_rating")
        .values(
          players.map((user_id) => ({
            user_id,
            rating: 1800,
            rd: 80,
            volatility: 0.06,
            games: 9,
          })),
        )
        .execute();
      const source = await trx
        .insertInto("source")
        .values({
          name: `tier-${randomUUID()}`,
          feed_url: `https://tier.example.test/${randomUUID()}.xml`,
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
          canonical_url: `https://tier.example.test/${randomUUID()}`,
          title: "Tiers",
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      let n = 0;
      const question = async (
        conceptId: string,
        difficulty: "intermediate" | "advanced",
      ) => {
        n += 1;
        const moment = await trx
          .insertInto("moment")
          .values({
            content_item_id: item.id,
            ordinal: n,
            title: `M${String(n)}`,
            estimated_minutes: 3,
            link: `https://tier.example.test/post#m${String(n)}`,
            link_type: "anchor",
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        const { id } = await trx
          .insertInto("question")
          .values({
            moment_id: moment.id,
            ordinal: 0,
            stem: `Q${String(n)}?`,
            options: ["right", "w1", "w2", "w3"],
            correct: 0,
            citation: "a b c",
            status: "live",
            difficulty,
            generator_model: "m",
            prompt_version: 1,
            content_hash: "h",
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("question_concept")
          .values({ question_id: id, concept_id: conceptId })
          .execute();
        return id;
      };
      const advancedGoal: string[] = [];
      for (let i = 0; i < 7; i += 1)
        advancedGoal.push(await question(goal.id, "advanced"));
      const intermediateGoal: string[] = [];
      for (let i = 0; i < 3; i += 1)
        intermediateGoal.push(await question(goal.id, "intermediate"));
      const onRetired: string[] = [];
      for (let i = 0; i < 3; i += 1)
        onRetired.push(await question(retired.id, "advanced"));

      const made = await kyselyMatches(trx).create(
        0,
        players,
        "fastest_finger",
      );
      if (made === null) throw new Error("no match");
      const picked = made.rounds.map((r) => r.question).sort();
      // The goal tier, at the pair's level, beats the retired "shared" questions.
      expect(picked).toEqual([...advancedGoal].sort());
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
});

// P3-W17-S01 (BOT-1, Q-P3-25; owner, 2026-11-03): a ghost is a same-mode run from the
// last 30 days by someone else, every question still live: never met first, the
// nearest rating first; with all met, the one met longest ago.
test("Postgres: a ghost match replays the nearest unmet run, in its questions' order", async () => {
  await expect(
    db.transaction().execute(async (trx: Transaction<DB>) => {
      const code = await trx
        .insertInto("invite_code")
        .values({
          code: `GHOST${randomUUID().slice(0, 8).toUpperCase()}`,
          beta_group: "developer",
          max_uses: 10,
          expires_at: sql<Date>`now() + interval '1 day'`,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const [me = "", a = "", b = "", c = ""] = [0, 1, 2, 3].map(
        () => `ghost-${randomUUID()}`,
      );
      await trx
        .insertInto("app_user")
        .values(
          [me, a, b, c].map((id) => ({
            id,
            name: "Ada",
            email: `${id}@ghost.example.test`,
            beta_group: "developer" as const,
            invite_code_id: code.id,
          })),
        )
        .execute();
      await trx
        .insertInto("player_rating")
        .values({ user_id: me, rating: 1600, rd: 80, volatility: 0.06 })
        .execute();
      const source = await trx
        .insertInto("source")
        .values({
          name: `ghost-${randomUUID()}`,
          feed_url: `https://ghost.example.test/${randomUUID()}.xml`,
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
          canonical_url: `https://ghost.example.test/${randomUUID()}`,
          title: "Ghosts",
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const moment = await trx
        .insertInto("moment")
        .values({
          content_item_id: item.id,
          ordinal: 0,
          title: "M",
          estimated_minutes: 3,
          link: "https://ghost.example.test/post#m",
          link_type: "anchor",
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const question = async (ordinal: number, status: "live" | "retired") =>
        (
          await trx
            .insertInto("question")
            .values({
              moment_id: moment.id,
              ordinal,
              stem: `Q${String(ordinal)}?`,
              options: ["right", "w1", "w2", "w3"],
              correct: 0,
              citation: "a b c",
              status,
              generator_model: "m",
              prompt_version: 1,
              content_hash: "h",
            })
            .returning("id")
            .executeTakeFirstOrThrow()
        ).id;
      const [q1, q2, q3] = [
        await question(0, "live"),
        await question(1, "live"),
        await question(2, "live"),
      ];
      const gone = await question(3, "retired");
      // A recorded run: its match's questions in order, and its answers.
      const run = async (
        owner: string,
        mode: "sprint" | "fastest_finger",
        rating: number,
        questions: string[],
        daysAgo = 1,
      ) => {
        const { id: matchId } = await trx
          .insertInto("game_match")
          .values({ server_id: 0, mode })
          .returning("id")
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("game_match_question")
          .values(
            questions.map((question_id, i) => ({
              match_id: matchId,
              round: i + 1,
              question_id,
            })),
          )
          .execute();
        return (
          await trx
            .insertInto("ghost_run")
            .values({
              match_id: matchId,
              user_id: owner,
              mode,
              rating,
              rd: 90,
              volatility: 0.06,
              answers: JSON.stringify([
                {
                  n: 1,
                  question_id: Number(questions[0]),
                  choice: 0,
                  ms: 4000,
                },
              ]),
              recorded_at: sql<Date>`now() - make_interval(days => ${daysAgo})`,
            })
            .returning("id")
            .executeTakeFirstOrThrow()
        ).id;
      };
      const near = await run(a, "fastest_finger", 1650, [q2, q1, q3]);
      const far = await run(b, "fastest_finger", 1720, [q1, q2, q3]);
      await run(me, "fastest_finger", 1600, [q1, q2, q3]); // the player's own
      await run(c, "fastest_finger", 1600, [q1, q2, q3], 40); // too old
      await run(c, "sprint", 1600, [q1, q2, q3]); // another mode
      await run(c, "fastest_finger", 1600, [q1, gone, q3]); // a question gone

      const matches = kyselyMatches(trx);
      const first = await matches.createGhost(0, me, "fastest_finger");
      if (first === null) throw new Error("no ghost");
      expect(first.players).toEqual([me, `ghost:${near}`]);
      expect(first.mode).toBe("fastest_finger");
      expect(first.rounds.map((r) => r.question)).toEqual([q2, q1, q3]);
      expect(first.rounds.map((r) => r.ai)).toEqual([true, true, true]);
      expect(first.ghost).toEqual({
        player: `ghost:${near}`,
        label: "Ghost · ~1700",
        answers: [{ n: 1, choice: 0, ms: 4000 }],
      });
      expect(
        await trx
          .selectFrom("game_match")
          .select([
            "mode",
            "ghost_run_id",
            "replay_seat",
            "replay_rating",
            "replay_rd",
          ])
          .where("id", "=", first.id)
          .executeTakeFirst(),
      ).toEqual({
        mode: "fastest_finger",
        ghost_run_id: near,
        replay_seat: `ghost:${near}`,
        replay_rating: 1650,
        replay_rd: 90,
      });
      expect(await matches.serverFor(first.id, me)).toEqual({
        serverId: 0,
        playedAs: me,
      });
      // Met: the next one; with both met, the one met longest ago.
      expect(
        (await matches.createGhost(0, me, "fastest_finger"))?.ghost?.player,
      ).toBe(`ghost:${far}`);
      await sql`update game_match set created_at = now() - interval '1 hour'
        where id = ${first.id}`.execute(trx);
      expect(
        (await matches.createGhost(0, me, "fastest_finger"))?.ghost?.player,
      ).toBe(`ghost:${near}`);
      // Only the player's own run of a mode: none.
      expect(await matches.createGhost(0, c, "sprint")).toBeNull();
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
});

// P3-W17-S02 (BOT-2, BOT-3, Q-P3-26): a bot's match is picked as the player's own, rated
// at the player's rating, labeled with its band; its run is a full replay.
test("Postgres: a bot match is labeled, rated at the player's own and fully played", async () => {
  await expect(
    db.transaction().execute(async (trx: Transaction<DB>) => {
      const code = await trx
        .insertInto("invite_code")
        .values({
          code: `BOT${randomUUID().slice(0, 8).toUpperCase()}`,
          beta_group: "developer",
          max_uses: 10,
          expires_at: sql<Date>`now() + interval '1 day'`,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const me = `bot-${randomUUID()}`;
      await trx
        .insertInto("app_user")
        .values({
          id: me,
          name: "Ada",
          email: `${me}@bot.example.test`,
          beta_group: "developer",
          invite_code_id: code.id,
        })
        .execute();
      await trx
        .insertInto("player_rating")
        .values({ user_id: me, rating: 1720, rd: 80, volatility: 0.06 })
        .execute();
      await seedLiveQuestions(trx, LIVE_QUESTIONS.sprint);
      const made = await kyselyMatches(trx).createBot(0, me, "sprint");
      if (made === null)
        throw new Error("no bot match (is the local bank empty?)");
      expect(made.players).toEqual([me, "bot"]);
      expect(made.rounds).toHaveLength(LIVE_QUESTIONS.sprint);
      expect(made.ghost?.player).toBe("bot");
      expect(made.ghost?.label).toBe("Bot · ~1700");
      const answers = made.ghost?.answers ?? [];
      expect(answers.map((a) => a.n)).toEqual(made.rounds.map((_, i) => i + 1));
      answers.forEach((a, i) => {
        const options = made.rounds[i]?.options.length ?? 0;
        expect(a.choice).toBeGreaterThanOrEqual(0);
        expect(a.choice).toBeLessThan(options);
        // A sprint's times add up from its start.
        if (i > 0) expect(a.ms).toBeGreaterThan(answers[i - 1]?.ms ?? 0);
      });
      expect(
        await trx
          .selectFrom("game_match")
          .select([
            "mode",
            "replay_seat",
            "replay_rating",
            "replay_rd",
            "ghost_run_id",
          ])
          .where("id", "=", made.id)
          .executeTakeFirst(),
      ).toEqual({
        mode: "sprint",
        replay_seat: "bot",
        replay_rating: 1720,
        replay_rd: 350,
        ghost_run_id: null,
      });
      expect(await kyselyMatches(trx).serverFor(made.id, me)).toEqual({
        serverId: 0,
        playedAs: me,
      });
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
});

// P3-W17-S02 (Q-P3-26) against data: the bot's first question (the player's only one in
// their own tier) is right at its real rate (16 of 20), at its live step time (each
// sprint run answered it 3.7 s after the question before).
test("Postgres: a bot plays a question at its real rate and live sprint time", async () => {
  const play = (roll: number) =>
    db.transaction().execute(async (trx: Transaction<DB>) => {
      const code = await trx
        .insertInto("invite_code")
        .values({
          code: `BOTD${randomUUID().slice(0, 8).toUpperCase()}`,
          beta_group: "developer",
          max_uses: 10,
          expires_at: sql<Date>`now() + interval '1 day'`,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const [me = "", other = ""] = [0, 1].map(() => `botd-${randomUUID()}`);
      await trx
        .insertInto("app_user")
        .values(
          [me, other].map((id) => ({
            id,
            name: "Ada",
            email: `${id}@botd.example.test`,
            beta_group: "developer" as const,
            invite_code_id: code.id,
          })),
        )
        .execute();
      const source = await trx
        .insertInto("source")
        .values({
          name: `botd-${randomUUID()}`,
          feed_url: `https://botd.example.test/${randomUUID()}.xml`,
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
          canonical_url: `https://botd.example.test/${randomUUID()}`,
          title: "Bots",
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const moment = await trx
        .insertInto("moment")
        .values({
          content_item_id: item.id,
          ordinal: 0,
          title: "M",
          estimated_minutes: 3,
          link: "https://botd.example.test/post#m",
          link_type: "anchor",
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const question = async (ordinal: number) =>
        (
          await trx
            .insertInto("question")
            .values({
              moment_id: moment.id,
              ordinal,
              stem: `B${String(ordinal)}?`,
              options: ["right", "w1", "w2", "w3"],
              correct: 0,
              citation: "a b c",
              status: "live",
              generator_model: "m",
              prompt_version: 1,
              content_hash: "h",
            })
            .returning("id")
            .executeTakeFirstOrThrow()
        ).id;
      const [x, y] = [await question(0), await question(1)];
      // The rest of a sprint, so a fresh database (CI) can make one.
      await seedLiveQuestions(trx, LIVE_QUESTIONS.sprint);
      // The player's own tier: a concept they know, on x only.
      const { id: concept } = await trx
        .insertInto("concept")
        .values({ slug: `botd-${randomUUID()}`, name: "B", topic: "databases" })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("question_concept")
        .values({ question_id: x, concept_id: concept })
        .execute();
      await trx
        .insertInto("concept_mastery")
        .values({
          user_id: me,
          concept_id: concept,
          probability: 0.3,
          state: "explored",
          evidence_count: 1,
        })
        .execute();
      // Five sprint runs: y at 1.0 s, then x at 4.7 s: x's step is 3.7 s.
      for (let r = 0; r < 5; r += 1) {
        const { id: matchId } = await trx
          .insertInto("game_match")
          .values({ server_id: 0, mode: "sprint" })
          .returning("id")
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("ghost_run")
          .values({
            match_id: matchId,
            user_id: other,
            mode: "sprint",
            rating: 1500,
            rd: 350,
            volatility: 0.06,
            answers: JSON.stringify([
              { n: 1, question_id: Number(y), choice: 0, ms: 1000 },
              { n: 2, question_id: Number(x), choice: 0, ms: 4700 },
            ]),
          })
          .execute();
      }
      // Twenty judged answers to x, sixteen right: a real rate of 0.8.
      for (let a = 0; a < 20; a += 1) {
        const { rows } = await sql<{ id: string }>`
          insert into quiz_attempt (user_id, review, finished_at)
          values (${other}, true, now())
          returning id`.execute(trx);
        await sql`insert into quiz_answer
            (attempt_id, question_id, served_at, answered_at, chosen, correct)
          values (${rows[0]?.id ?? ""}, ${x}, now(), now(), 0, ${a < 16})`.execute(
          trx,
        );
      }
      const made = await kyselyMatches(trx, () => roll).createBot(
        0,
        me,
        "sprint",
      );
      if (made === null) throw new Error("no bot match");
      expect(made.rounds[0]?.question).toBe(x);
      const first = made.ghost?.answers[0];
      throw new Rollback(JSON.stringify(first));
    });
  const first = async (roll: number) => {
    try {
      await play(roll);
    } catch (error) {
      if (error instanceof Rollback)
        return JSON.parse(error.message) as unknown;
      throw error;
    }
    throw new Error("no rollback");
  };
  // 0.79 < 0.8: right, at x's own step time; 0.81: a wrong option.
  expect(await first(0.79)).toEqual({ n: 1, choice: 0, ms: 3700 });
  expect(await first(0.81)).toMatchObject({ n: 1, ms: 3700 });
  expect(((await first(0.81)) as { choice: number }).choice).not.toBe(0);
});
