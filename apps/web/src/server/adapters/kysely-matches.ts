import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { type Kysely, sql } from "kysely";
import {
  type GameMode,
  type GhostAnswer,
  LIVE_QUESTIONS,
  type LiveRound,
  type Matches,
} from "../ports";
import { botAnswers } from "../bots";
import { type BankQuestion, levelFor, pickRounds } from "../live-questions";
import { LIVE } from "./kysely-quizzes";

// ADR-0034: a player not yet rated counts as the starting rating (the worker's
// interval_jobs/ratings.py START).
const START_RATING = 1500;
// Q-P3-26: a bot is an opponent at the player's own rating with Glickman's starting RD
// and volatility (the worker's START).
const BOT_RD = 350;
const BOT_VOLATILITY = 0.06;
// How many of the mode's live times a bot draws from, for questions with too few.
const MODE_SAMPLE = 500;

// A rating as a label shows it (BOT-3): to the nearest hundred.
const band = (rating: number) => String(Math.round(rating / 100) * 100);

const toRound = ({
  question,
  stem,
  options,
  correct,
  ai,
}: BankQuestion): LiveRound => ({
  question,
  stem,
  options,
  correct,
  ai,
});

// P3-W15-S02, S03 (ADR-0033, Q-P3-22): live matches, their players and their questions.
// `random`: a bot's draws (P3-W17-S02); tests fix it.
export function kyselyMatches(
  db: Kysely<DB>,
  random: () => number = Math.random,
): Matches {
  // Kysely can't nest transactions: inside one (as the tests run), use it.
  const inTransaction = <T>(body: (trx: Kysely<DB>) => Promise<T>) =>
    db.isTransaction ? body(db) : db.transaction().execute(body);
  // MATCH-4 (P3-W16-S03): the questions these players play, or null when the bank is
  // short; and their ratings, for those who have one.
  const questionsFor = async (
    trx: Kysely<DB>,
    players: string[],
    mode: GameMode,
  ): Promise<{ picked: BankQuestion[]; rated: Map<string, number> } | null> => {
    // MATCH-4 (P3-W16-S03): from what the two share, at their level.
    // shortcut: the whole live bank per match (about a thousand rows); narrow it
    // to the tiers' concepts in SQL once it passes some ten thousand.
    const { rows: bank } = await sql<BankQuestion>`
      select q.id::text as question, q.stem, q.options, q.correct,
             q.generator_model is not null as ai, q.difficulty as level,
             coalesce(array_agg(c.id::text)
               filter (where c.id is not null), '{}') as concepts
      from ${LIVE}
      left join question_concept qc on qc.question_id = q.id
      left join concept c on c.id = qc.concept_id and c.retired_at is null
      where q.status = 'live'
      group by q.id
    `.execute(trx);
    // Retired concepts never count: no question carries one (above).
    const known = await trx
      .selectFrom("concept_mastery as m")
      .innerJoin("concept as c", "c.id", "m.concept_id")
      .select(["m.user_id", "m.concept_id"])
      .where("m.user_id", "in", players)
      .where("c.retired_at", "is", null)
      .execute();
    const of = (userId: string) =>
      new Set(
        known.filter((k) => k.user_id === userId).map((k) => k.concept_id),
      );
    const [first = new Set<string>(), ...rest] = players.map(of);
    const shared = new Set(
      [...first].filter((c) => rest.every((other) => other.has(c))),
    );
    // Goal concepts as the solo sprint has them (user_goal_concepts, ADR-0015).
    const goals = new Set(
      (
        await sql<{ id: string }>`
          select g.concept_id::text as id
          from unnest(array[${sql.join(players)}]::text[]) u(id)
          cross join user_goal_concepts(u.id) g
        `.execute(trx)
      ).rows.map((r) => r.id),
    );
    const rated = new Map(
      (
        await trx
          .selectFrom("player_rating")
          .select(["user_id", "rating"])
          .where("user_id", "in", players)
          .execute()
      ).map((r) => [r.user_id, r.rating]),
    );
    const average =
      players.reduce(
        (sum, userId) => sum + (rated.get(userId) ?? START_RATING),
        0,
      ) / players.length;
    const picked = pickRounds(
      bank,
      { shared, goals },
      levelFor(average),
      LIVE_QUESTIONS[mode],
    );
    return picked.length < LIVE_QUESTIONS[mode] ? null : { picked, rated };
  };

  // A match and its questions in order, and its people (a ghost or bot is no row).
  const store = async (
    trx: Kysely<DB>,
    match: {
      serverId: number;
      mode: GameMode;
      people: string[];
      questions: string[];
      unrated?: boolean;
      // P3-W17-S01, S02: a ghost's or bot's seat and the Glicko it is rated as.
      replay?: {
        seat: string;
        rating: number;
        rd: number;
        volatility: number;
        ghostRunId?: string;
      };
    },
  ): Promise<string> => {
    const { id } = await trx
      .insertInto("game_match")
      .values({
        server_id: match.serverId,
        mode: match.mode,
        unrated: match.unrated ?? false,
        ghost_run_id: match.replay?.ghostRunId ?? null,
        replay_seat: match.replay?.seat ?? null,
        replay_rating: match.replay?.rating ?? null,
        replay_rd: match.replay?.rd ?? null,
        replay_volatility: match.replay?.volatility ?? null,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("game_match_player")
      .values(match.people.map((user_id) => ({ match_id: id, user_id })))
      .execute();
    await trx
      .insertInto("game_match_question")
      .values(
        match.questions.map((question_id, i) => ({
          match_id: id,
          round: i + 1,
          question_id,
        })),
      )
      .execute();
    return id;
  };

  return {
    create: (serverId, players, mode, options) =>
      inTransaction(async (trx) => {
        const chosen = await questionsFor(trx, players, mode);
        if (chosen === null) return null;
        const rounds = chosen.picked.map(toRound);
        const id = await store(trx, {
          serverId,
          mode,
          people: players,
          questions: rounds.map((r) => r.question),
          unrated: options?.unrated ?? false,
        });
        return { id, serverId, players, mode, rounds };
      }),

    createBattle: (serverId, players, slug, options) =>
      inTransaction(async (trx) => {
        const { id } = await trx
          .insertInto("game_match")
          .values({
            server_id: serverId,
            mode: "battle",
            problem_slug: slug,
            unrated: options?.unrated ?? false,
            league: options?.league ?? "human",
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        await trx
          .insertInto("game_match_player")
          .values(players.map((user_id) => ({ match_id: id, user_id })))
          .execute();
        return id;
      }),

    // P3-W17-S02 (BOT-2, Q-P3-26): a synthetic bot's match: the player's questions as
    // a match's are picked, the bot's answers drawn from real rates and times.
    createBot: (serverId, userId, mode) =>
      inTransaction(async (trx) => {
        const chosen = await questionsFor(trx, [userId], mode);
        if (chosen === null) return null;
        const ids = chosen.picked.map((q) => q.question);
        const { rows: rates } = await sql<{
          question: string;
          answers: number;
          right: number;
        }>`
          select question_id::text as question, count(*)::int as answers,
                 (avg(case when correct then 1 else 0 end))::float8 as right
          from quiz_answer
          where correct is not null and question_id in (${sql.join(ids)})
          group by question_id
        `.execute(trx);
        // Live times per question: fastest finger's are per round; a sprint's are from
        // its start, so each is the step from the answer before.
        // Recent runs only (the ghosts' 30 days): each picked question's times, and a
        // bounded sample of the mode's for questions with too few.
        const { rows: times } = await sql<{ question: string; took: number }>`
          with steps as (
            select (a->>'question_id') as question,
              case when g.mode = 'sprint'
                then (a->>'ms')::bigint - coalesce(lag((a->>'ms')::bigint)
                  over (partition by g.id order by (a->>'n')::int), 0)
                else (a->>'ms')::bigint end::int as took
            from ghost_run g, jsonb_array_elements(g.answers) a
            where g.mode = ${mode} and g.recorded_at > now() - interval '30 days'
          )
          (select question, took from steps
           where took > 0 and question in (${sql.join(ids)}))
          union all
          (select '' as question, took from steps where took > 0
           order by random() limit ${MODE_SAMPLE})
        `.execute(trx);
        const usable = times.filter((t) => t.question !== "");
        const rating = chosen.rated.get(userId) ?? START_RATING;
        const answers = botAnswers(
          chosen.picked.map((q) => {
            const rate = rates.find((r) => r.question === q.question);
            return {
              correct: q.correct,
              options: q.options.length,
              level: q.level,
              answers: rate?.answers ?? 0,
              rightRate: rate?.right ?? 0,
              times: usable
                .filter((t) => t.question === q.question)
                .map((t) => t.took),
            };
          }),
          times.filter((t) => t.question === "").map((t) => t.took),
          mode,
          random,
        );
        const id = await store(trx, {
          serverId,
          mode,
          people: [userId],
          questions: ids,
          // Q-P3-26: rated as the player's own rating, RD 350.
          replay: {
            seat: "bot",
            rating,
            rd: BOT_RD,
            volatility: BOT_VOLATILITY,
          },
        });
        return {
          id,
          serverId,
          players: [userId, "bot"],
          mode,
          rounds: chosen.picked.map(toRound),
          // BOT-3: always labeled; rated at the player's own rating (Q-P3-26).
          ghost: { player: "bot", label: `Bot · ~${band(rating)}`, answers },
        };
      }),

    createGhost: (serverId, userId, mode) =>
      inTransaction(async (trx) => {
        // Q-P3-25: by the player's rating now (the start before any match, ADR-0034).
        const { rows } = await sql<{
          id: string;
          rating: number;
          rd: number;
          volatility: number;
          answers: GhostAnswer[];
          match_id: string;
        }>`
          with me as (
            select coalesce(
              (select rating from player_rating where user_id = ${userId}),
              ${START_RATING}) as rating
          )
          select g.id::text, g.rating, g.rd, g.volatility, g.answers,
                 g.match_id::text
          from ghost_run g
          cross join me
          left join lateral (
            select max(m.created_at) as at from game_match m
            join game_match_player p on p.match_id = m.id
            where m.ghost_run_id = g.id and p.user_id = ${userId}
          ) met on true
          where g.mode = ${mode} and g.user_id <> ${userId}
            and g.recorded_at > now() - interval '30 days'
            and not exists (
              select 1 from game_match_question r
              where r.match_id = g.match_id
                and r.question_id not in (
                  select q.id from ${LIVE} where q.status = 'live'))
          order by met.at is not null,
            case when met.at is null then abs(g.rating - me.rating) end,
            met.at, g.id
          limit 1
        `.execute(trx);
        const run = rows[0];
        if (run === undefined) return null;
        const rounds: LiveRound[] = (
          await trx
            .selectFrom("game_match_question as r")
            .innerJoin("question as q", "q.id", "r.question_id")
            .select([
              "q.id",
              "q.stem",
              "q.options",
              "q.correct",
              sql<boolean>`q.generator_model is not null`.as("ai"),
            ])
            .where("r.match_id", "=", run.match_id)
            .orderBy("r.round")
            .execute()
        ).map((q) => {
          // Live multiple choice (checked above) has both; the schema allows neither.
          if (q.options === null || q.correct === null)
            throw new Error(`question ${q.id} has no options or key`);
          return {
            question: q.id,
            stem: q.stem,
            options: q.options,
            correct: q.correct,
            ai: q.ai,
          };
        });
        const id = await store(trx, {
          serverId,
          mode,
          people: [userId],
          questions: rounds.map((r) => r.question),
          replay: {
            seat: `ghost:${run.id}`,
            rating: run.rating,
            rd: run.rd,
            volatility: run.volatility,
            ghostRunId: run.id,
          },
        });
        const player = `ghost:${run.id}`;
        return {
          id,
          serverId,
          players: [userId, player],
          mode,
          rounds,
          ghost: {
            player,
            // BOT-3: a band, never whose run it is.
            label: `Ghost · ~${band(run.rating)}`,
            answers: run.answers.map(({ n, choice, ms }) => ({
              n,
              choice,
              ms,
            })),
          },
        };
      }),

    serverFor: async (matchId, userId) => {
      const row = await db
        .selectFrom("game_match as m")
        .innerJoin("game_match_player as p", "p.match_id", "m.id")
        .select(["m.server_id", "p.played_as", "m.problem_slug"])
        .where("m.id", "=", matchId)
        .where("p.user_id", "=", userId)
        .executeTakeFirst();
      return row === undefined
        ? null
        : {
            serverId: row.server_id,
            playedAs: row.played_as ?? userId,
            problem: row.problem_slug,
          };
    },
  };
}

// The in-memory fake (ADR-0012), over the given matches and a bank of live questions.
export function memoryMatches(
  matches: Map<
    string,
    { serverId: number; players: string[]; problem?: string }
  >,
  bank: LiveRound[] = [],
): Matches {
  return {
    create: (serverId, players, mode) => {
      if (bank.length < LIVE_QUESTIONS[mode]) return Promise.resolve(null);
      const id = randomUUID();
      matches.set(id, { serverId, players });
      return Promise.resolve({
        id,
        serverId,
        players,
        mode,
        rounds: bank.slice(0, LIVE_QUESTIONS[mode]),
      });
    },
    createBattle: (serverId, players, slug) => {
      const id = randomUUID();
      matches.set(id, { serverId, players, problem: slug });
      return Promise.resolve(id);
    },
    // No recorded runs in the fake: never a ghost.
    createGhost: () => Promise.resolve(null),
    // No bots in the fake either: the route's order is tested with stubs.
    createBot: () => Promise.resolve(null),
    serverFor: (matchId, userId) => {
      const match = matches.get(matchId);
      return Promise.resolve(
        match?.players.includes(userId) === true
          ? {
              serverId: match.serverId,
              playedAs: userId,
              problem: match.problem ?? null,
            }
          : null,
      );
    },
  };
}
