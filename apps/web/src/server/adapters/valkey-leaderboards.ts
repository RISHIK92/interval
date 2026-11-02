import type { DB } from "@interval/db";
import type { Redis } from "ioredis";
import { type Kysely, sql } from "kysely";
import { log } from "../log";
import type { Leaderboards, Standing } from "../ports";

// P3-W14-S01 (CACHE-3): boards are Valkey sorted sets of player totals; board_score in
// Postgres is the truth. A board missing from Valkey (never read, expired, evicted,
// flushed by `pnpm boards:rebuild`, or invalidated) is rebuilt from Postgres on its
// next read. The marker that says a board is whole lives only minutes, so a write that
// failed or raced a rebuild shows for at most that long; a rebuild is one grouped query.
const TTL_SECONDS = 8 * 86_400;
const BUILT_SECONDS = 600;

// An attempt's board (owner, 2026-11-02): its daily's day, or the ISO week (UTC) it
// started in; null when it isn't a game.
const BOARD = sql<string | null>`case
  when a.daily_day is not null then 'daily:' || to_char(a.daily_day, 'YYYY-MM-DD')
  when a.estimation then 'estimation:'
    || to_char(a.started_at at time zone 'utc', 'IYYY-"W"IW')
  when a.sprint then 'sprint:'
    || to_char(a.started_at at time zone 'utc', 'IYYY-"W"IW')
end`;

// Sorted highest first; equal totals share a rank, 1 + the players strictly ahead.
function ranked(entries: { userId: string; score: number }[]): Standing[] {
  let rank = 0;
  return entries.map((entry, index) => {
    if (index === 0 || entry.score !== entries[index - 1]?.score)
      rank = index + 1;
    return { ...entry, rank };
  });
}

// Within a tie, as Valkey's ZREVRANGE orders members: by id, descending.
const byScore = (
  x: { userId: string; score: number },
  y: { userId: string; score: number },
) => y.score - x.score || (y.userId < x.userId ? -1 : 1);

export function valkeyLeaderboards(
  db: Kysely<DB>,
  redis: Redis,
  prefix = "board:",
): Leaderboards {
  // P3-W14-S02: a country's board is "<board>@<country>".
  const name = (board: string, country?: string) =>
    country === undefined ? board : `${board}@${country}`;
  const key = (board: string, country?: string) =>
    `${prefix}${name(board, country)}`;
  const marker = (board: string, country?: string) =>
    `${prefix}built:${name(board, country)}`;

  // The players' totals on a board; on a country's, only those whose country it is now.
  const totals = (
    board: string,
    only: { userId?: string; country?: string | undefined } = {},
  ) =>
    sql<{ user_id: string; score: number }>`
      select a.user_id, sum(s.score)::int as score
      from board_score s join quiz_attempt a on a.id = s.attempt_id
      where s.board = ${board}
        and ${only.userId === undefined ? sql`true` : sql`a.user_id = ${only.userId}`}
        and ${
          only.country === undefined
            ? sql`true`
            : sql`exists (select 1 from player_country c
                  where c.user_id = a.user_id and c.country = ${only.country})`
        }
      group by a.user_id
    `.execute(db);

  // ioredis reports a command's own failure in its reply, not as a rejection.
  const exec = async (multi: ReturnType<Redis["multi"]>): Promise<void> => {
    const failed = (await multi.exec())?.find(([error]) => error !== null);
    if (failed?.[0] != null) throw failed[0];
  };

  // A game recorded between the select and the write is overwritten with the older
  // total until the marker lapses (BUILT_SECONDS). An empty board has no key, so it is
  // worked out at each read: one query that finds nothing.
  // shortcut: one ZADD of every player, fine to some tens of thousands; batch beyond.
  const ensure = async (board: string, country?: string): Promise<void> => {
    const [k, m] = [key(board, country), marker(board, country)];
    if ((await redis.exists(m, k)) === 2) return;
    const { rows } = await totals(board, { country });
    const multi = redis.multi().del(k);
    if (rows.length > 0)
      multi
        .zadd(k, ...rows.flatMap((r) => [r.score, r.user_id]))
        .expire(k, TTL_SECONDS);
    await exec(multi.set(m, "1", "EX", BUILT_SECONDS));
  };

  const countryOf = async (userId: string): Promise<string | undefined> =>
    (
      await db
        .selectFrom("player_country")
        .select("country")
        .where("user_id", "=", userId)
        .executeTakeFirst()
    )?.country ?? undefined;

  return {
    record: async (userId, attemptId, score) => {
      await sql`
        insert into board_score (attempt_id, board, score)
        select a.id, ${BOARD}, ${score} from quiz_attempt a
        where a.id = ${attemptId} and a.user_id = ${userId}
          and a.finished_at is not null and ${BOARD} is not null
        on conflict (attempt_id) do nothing
      `.execute(db);
      // Again for a repeat (LOAD-5), which mends a board a failed write left behind.
      const row = await db
        .selectFrom("board_score as s")
        .innerJoin("quiz_attempt as a", "a.id", "s.attempt_id")
        .select("s.board")
        .where("s.attempt_id", "=", attemptId)
        .where("a.user_id", "=", userId)
        .executeTakeFirst();
      if (row === undefined) return;
      const total = (await totals(row.board, { userId })).rows[0]?.score ?? 0;
      const country = await countryOf(userId);
      try {
        // GT: a total only grows, so a stale one written late never wins.
        const multi = redis
          .multi()
          .zadd(key(row.board), "GT", total, userId)
          .expire(key(row.board), TTL_SECONDS);
        if (country !== undefined)
          multi
            .zadd(key(row.board, country), "GT", total, userId)
            .expire(key(row.board, country), TTL_SECONDS);
        await exec(multi);
      } catch (error) {
        // LOAD-5: the game is kept in Postgres, and the board rebuilds with it once
        // its marker lapses (a metric in the AWS stack counts these).
        log.error("boards: write failed", {
          board: row.board,
          error,
        });
      }
    },

    top: async (board, limit, country) => {
      await ensure(board, country);
      const flat = await redis.zrevrange(
        key(board, country),
        0,
        limit - 1,
        "WITHSCORES",
      );
      const entries: { userId: string; score: number }[] = [];
      for (let i = 0; i + 1 < flat.length; i += 2)
        entries.push({ userId: flat[i] ?? "", score: Number(flat[i + 1]) });
      return ranked(entries);
    },

    standing: async (board, userId, country) => {
      await ensure(board, country);
      const k = key(board, country);
      const score = await redis.zscore(k, userId);
      if (score === null) return null;
      const ahead = await redis.zcount(k, `(${score}`, "+inf");
      return { userId, score: Number(score), rank: ahead + 1 };
    },

    // Never throws: it follows a sign-in that has already succeeded. If it fails, the
    // boards show the guest apart until their markers lapse (BUILT_SECONDS).
    invalidate: async (userId, formerCountry) => {
      try {
        // Its global boards, and those of its country now and the one it was.
        const scopes = [
          undefined,
          await countryOf(userId),
          formerCountry ?? undefined,
        ];
        const boards = await db
          .selectFrom("board_score as s")
          .innerJoin("quiz_attempt as a", "a.id", "s.attempt_id")
          .select("s.board")
          .distinct()
          .where("a.user_id", "=", userId)
          .execute();
        if (boards.length > 0)
          await redis.del(
            ...boards.flatMap((b) =>
              scopes.flatMap((c) => [marker(b.board, c), key(b.board, c)]),
            ),
          );
      } catch (error) {
        log.error("boards: invalidation failed", { userId, error });
      }
    },
  };
}

// The in-memory fake (ADR-0012): each attempt's player and board are given.
export function memoryLeaderboards(
  games: Map<
    string,
    { userId: string; board: string | null; finished: boolean }
  >,
  countries: Map<string, string> = new Map(),
): Leaderboards {
  const scores = new Map<string, number>();
  const board = (name: string, country?: string) => {
    const sums = new Map<string, number>();
    for (const [attemptId, score] of scores) {
      const game = games.get(attemptId);
      if (
        game?.board === name &&
        (country === undefined || countries.get(game.userId) === country)
      )
        sums.set(game.userId, (sums.get(game.userId) ?? 0) + score);
    }
    return ranked(
      [...sums].map(([userId, score]) => ({ userId, score })).sort(byScore),
    );
  };
  return {
    record: (userId, attemptId, score) => {
      const game = games.get(attemptId);
      if (
        game?.userId === userId &&
        game.finished &&
        game.board !== null &&
        !scores.has(attemptId)
      )
        scores.set(attemptId, score);
      return Promise.resolve();
    },
    top: (name, limit, country) =>
      Promise.resolve(board(name, country).slice(0, limit)),
    standing: (name, userId, country) =>
      Promise.resolve(
        board(name, country).find((s) => s.userId === userId) ?? null,
      ),
    invalidate: () => Promise.resolve(),
  };
}
