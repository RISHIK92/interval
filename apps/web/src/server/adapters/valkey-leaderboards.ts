import type { DB } from "@interval/db";
import type { Redis } from "ioredis";
import { type Kysely, type RawBuilder, sql } from "kysely";
import { log } from "../log";
import type {
  BoardScope,
  Leaderboards,
  Standing,
  UniversityStanding,
} from "../ports";

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

// Sorted highest first; equal scores share a rank, 1 + the entries strictly ahead.
function ranked<T extends { score: number }>(
  entries: T[],
): (T & { rank: number })[] {
  let rank = 0;
  return entries.map((entry, index) => {
    if (index === 0 || entry.score !== entries[index - 1]?.score)
      rank = index + 1;
    return { ...entry, rank };
  });
}

// Within a tie, as Valkey's ZREVRANGE orders members: by id, descending.
const byScore =
  <T extends { score: number }>(id: (entry: T) => string) =>
  (x: T, y: T) =>
    y.score - x.score || (id(y) < id(x) ? -1 : 1);

// Valkey's flat [member, score, ...] reply.
function pairs(flat: string[]): { member: string; score: number }[] {
  const out: { member: string; score: number }[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2)
    out.push({ member: flat[i] ?? "", score: Number(flat[i + 1]) });
  return out;
}

export function valkeyLeaderboards(
  db: Kysely<DB>,
  redis: Redis,
  prefix = "board:",
): Leaderboards {
  // P3-W14-S02: a country's board is "<board>@<country>"; P3-W14-S04: a university's
  // "<board>#<id>", and the universities ranked on a board "<board>/universities".
  const name = (board: string, scope?: BoardScope) =>
    scope === undefined
      ? board
      : "country" in scope
        ? `${board}@${scope.country}`
        : `${board}#${scope.university}`;
  const ranking = (board: string) => `${board}/universities`;
  const key = (n: string) => `${prefix}${n}`;
  const marker = (n: string) => `${prefix}built:${n}`;

  // Each player's score on a board, of the players `who` admits (given the user id
  // column). P3-W16-S06 (Q-P3-13): a season's is the quick-game rating, the one kept at
  // its close or, while open, the current one of each player rated that month; every
  // other board's is the sum of its games' scores.
  const scores = (
    board: string,
    who: (user: RawBuilder<unknown>) => RawBuilder<unknown>,
  ) => {
    const season = /^season:(\d{4})-(\d{2})$/.exec(board);
    if (season === null)
      return sql<{ user_id: string; score: number }>`
        select a.user_id, sum(s.score)::float8 as score
        from board_score s join quiz_attempt a on a.id = s.attempt_id
        where s.board = ${board} and ${who(sql.ref("a.user_id"))}
        group by a.user_id`;
    const [, year = "", month = ""] = season;
    const name = `${year}-${month}`;
    const start = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
    const end = new Date(Date.UTC(Number(year), Number(month), 1));
    return sql<{ user_id: string; score: number }>`
      select k.user_id, k.rating as score from season_standing k
      where k.season = ${name} and ${who(sql.ref("k.user_id"))}
      union all
      select r.user_id, r.rating from player_rating r
      where ${who(sql.ref("r.user_id"))}
        and not exists (select 1 from season_close c where c.season = ${name})
        and exists (select 1 from rating_history h where h.user_id = r.user_id
          and h.at >= ${start} and h.at < ${end})`;
  };

  // The players' scores on a board; on a country's or university's, only the players
  // in it now.
  const totals = (
    board: string,
    only: { userId?: string; scope?: BoardScope | undefined },
  ) =>
    sql<{ member: string; score: number }>`
      select t.user_id as member, t.score
      from (${scores(
        board,
        (
          user,
        ) => sql`${only.userId === undefined ? sql`true` : sql`${user} = ${only.userId}`}
          and ${
            only.scope === undefined
              ? sql`true`
              : "country" in only.scope
                ? sql`exists (select 1 from player_country c
                    where c.user_id = ${user} and c.country = ${only.scope.country})`
                : sql`exists (select 1 from player_university u
                    where u.user_id = ${user}
                      and u.university_id = ${only.scope.university})`
          }`,
      )}) t
    `.execute(db);

  // Q-P3-10 (owner, 2026-11-02): each university's average score over its players with
  // one on the board (C-17: on a season board, their average rating); one university's
  // when given.
  const averages = (board: string, universityId?: string) =>
    sql<{ member: string; score: number }>`
      select u.university_id::text as member, avg(t.score)::float8 as score
      from (${scores(board, (user) =>
        // Inside, so one university's average doesn't work out the whole board.
        universityId === undefined
          ? sql`true`
          : sql`${user} in (select user_id from player_university
              where university_id = ${universityId})`,
      )}) t join player_university u on u.user_id = t.user_id
      where u.university_id is not null
      group by u.university_id
    `.execute(db);

  // ioredis reports a command's own failure in its reply, not as a rejection.
  const exec = async (multi: ReturnType<Redis["multi"]>): Promise<void> => {
    const failed = (await multi.exec())?.find(([error]) => error !== null);
    if (failed?.[0] != null) throw failed[0];
  };

  // A game recorded between the select and the write is overwritten with the older
  // total until the marker lapses (BUILT_SECONDS). An empty board has no key, so it is
  // worked out at each read: one query that finds nothing.
  // shortcut: one ZADD of every member, fine to some tens of thousands; batch beyond.
  const ensure = async (
    n: string,
    build: () => Promise<{ rows: { member: string; score: number }[] }>,
  ): Promise<void> => {
    const [k, m] = [key(n), marker(n)];
    if ((await redis.exists(m, k)) === 2) return;
    const { rows } = await build();
    const multi = redis.multi().del(k);
    if (rows.length > 0)
      multi
        .zadd(k, ...rows.flatMap((r) => [r.score, r.member]))
        .expire(k, TTL_SECONDS);
    await exec(multi.set(m, "1", "EX", BUILT_SECONDS));
  };
  const ensureBoard = (board: string, scope?: BoardScope) =>
    ensure(name(board, scope), () => totals(board, { scope }));
  const ensureRanking = (board: string) =>
    ensure(ranking(board), () => averages(board));

  // ZREVRANGE's stop of -1 would be the whole set.
  const highest = async (n: string, limit: number) =>
    limit < 1
      ? []
      : pairs(await redis.zrevrange(key(n), 0, limit - 1, "WITHSCORES"));
  const place = async (n: string, member: string) => {
    const score = await redis.zscore(key(n), member);
    if (score === null) return null;
    const ahead = await redis.zcount(key(n), `(${score}`, "+inf");
    return { score: Number(score), rank: ahead + 1 };
  };

  // The player's scopes now.
  const scopesOf = async (userId: string): Promise<BoardScope[]> => {
    const row = await db
      .selectFrom("app_user as p")
      .leftJoin("player_country as c", "c.user_id", "p.id")
      .leftJoin("player_university as u", "u.user_id", "p.id")
      .select(["c.country", "u.university_id"])
      .where("p.id", "=", userId)
      .executeTakeFirst();
    return [
      ...(row?.country == null ? [] : [{ country: row.country }]),
      ...(row?.university_id == null
        ? []
        : [{ university: row.university_id }]),
    ];
  };

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
      const board = row.board;
      const total = (await totals(board, { userId })).rows[0]?.score ?? 0;
      const scopes = await scopesOf(userId);
      const university = scopes.find((s) => "university" in s);
      const average =
        university === undefined
          ? undefined
          : (await averages(board, university.university)).rows[0];
      try {
        // GT: a total only grows, so a stale one written late never wins.
        const multi = redis.multi();
        for (const scope of [undefined, ...scopes])
          multi
            .zadd(key(name(board, scope)), "GT", total, userId)
            .expire(key(name(board, scope)), TTL_SECONDS);
        // An average can fall (a new player joins), so no GT: one written late is
        // wrong until the ranking's marker lapses.
        if (average !== undefined)
          multi
            .zadd(key(ranking(board)), average.score, average.member)
            .expire(key(ranking(board)), TTL_SECONDS);
        await exec(multi);
      } catch (error) {
        // LOAD-5: the game is kept in Postgres, and the board rebuilds with it once
        // its marker lapses (a metric in the AWS stack counts these).
        log.error("boards: write failed", { board, error });
      }
    },

    top: async (board, limit, scope) => {
      await ensureBoard(board, scope);
      return ranked(
        (await highest(name(board, scope), limit)).map((p) => ({
          userId: p.member,
          score: p.score,
        })),
      );
    },

    standing: async (board, userId, scope) => {
      await ensureBoard(board, scope);
      const found = await place(name(board, scope), userId);
      return found === null ? null : { userId, ...found };
    },

    among: async (board, userIds) => {
      if (userIds.length === 0) return [];
      await ensureBoard(board);
      const scores = await redis.zmscore(key(name(board)), ...userIds);
      return ranked(
        userIds
          .flatMap((userId, i) => {
            const score = scores[i];
            return score == null ? [] : [{ userId, score: Number(score) }];
          })
          .sort(byScore((s) => s.userId)),
      );
    },

    size: async (board, scope) => {
      await ensureBoard(board, scope);
      return redis.zcard(key(name(board, scope)));
    },

    universities: async (board, limit) => {
      await ensureRanking(board);
      return ranked(
        (await highest(ranking(board), limit)).map((p) => ({
          universityId: p.member,
          score: p.score,
        })),
      );
    },

    universityCount: async (board) => {
      await ensureRanking(board);
      return redis.zcard(key(ranking(board)));
    },

    universityStanding: async (board, universityId) => {
      await ensureRanking(board);
      const found = await place(ranking(board), universityId);
      return found === null ? null : { universityId, ...found };
    },

    // Never throws: it follows a change that has already succeeded. If it fails, the
    // boards show the player where they were until their markers lapse (BUILT_SECONDS).
    invalidate: async (userId, former = []) => {
      try {
        // Its global boards, those of its scopes now and before, and the rankings of
        // the universities whose averages it counts in.
        const scopes = [undefined, ...(await scopesOf(userId)), ...former];
        // P3-W16-S06: and the seasons it was rated in.
        const { rows: boards } = await sql<{ board: string }>`
          select s.board from board_score s
          join quiz_attempt a on a.id = s.attempt_id
          where a.user_id = ${userId}
          union
          select 'season:' || to_char(h.at at time zone 'utc', 'YYYY-MM')
          from rating_history h where h.user_id = ${userId}
        `.execute(db);
        const names = boards.flatMap((b) => [
          ranking(b.board),
          ...scopes.map((scope) => name(b.board, scope)),
        ]);
        if (names.length > 0)
          await redis.del(...names.flatMap((n) => [marker(n), key(n)]));
      } catch (error) {
        log.error("boards: invalidation failed", { userId, error });
      }
    },
  };
}

// The in-memory fake (ADR-0012): each attempt's player and board are given, and each
// player's country and university.
export function memoryLeaderboards(
  games: Map<
    string,
    { userId: string; board: string | null; finished: boolean }
  >,
  countries: Map<string, string> = new Map(),
  universities: Map<string, string> = new Map(),
): Leaderboards {
  const scores = new Map<string, number>();
  const inScope = (userId: string, scope?: BoardScope) =>
    scope === undefined ||
    ("country" in scope
      ? countries.get(userId) === scope.country
      : universities.get(userId) === scope.university);
  const sums = (name: string) => {
    const out = new Map<string, number>();
    for (const [attemptId, score] of scores) {
      const game = games.get(attemptId);
      if (game?.board === name)
        out.set(game.userId, (out.get(game.userId) ?? 0) + score);
    }
    return out;
  };
  const board = (name: string, scope?: BoardScope): Standing[] =>
    ranked(
      [...sums(name)]
        .filter(([userId]) => inScope(userId, scope))
        .map(([userId, score]) => ({ userId, score }))
        .sort(byScore((s) => s.userId)),
    );
  const ranking = (name: string): UniversityStanding[] => {
    const members = new Map<string, number[]>();
    for (const [userId, total] of sums(name)) {
      const universityId = universities.get(userId);
      if (universityId !== undefined)
        members.set(universityId, [
          ...(members.get(universityId) ?? []),
          total,
        ]);
    }
    return ranked(
      [...members]
        .map(([universityId, totals]) => ({
          universityId,
          score: totals.reduce((x, y) => x + y, 0) / totals.length,
        }))
        .sort(byScore((s) => s.universityId)),
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
    top: (name, limit, scope) =>
      Promise.resolve(board(name, scope).slice(0, limit)),
    standing: (name, userId, scope) =>
      Promise.resolve(
        board(name, scope).find((s) => s.userId === userId) ?? null,
      ),
    among: (name, userIds) =>
      Promise.resolve(
        ranked(
          board(name)
            .filter((s) => userIds.includes(s.userId))
            .map(({ userId, score }) => ({ userId, score }))
            .sort(byScore((s) => s.userId)),
        ),
      ),
    size: (name, scope) => Promise.resolve(board(name, scope).length),
    universities: (name, limit) =>
      Promise.resolve(ranking(name).slice(0, limit)),
    universityCount: (name) => Promise.resolve(ranking(name).length),
    universityStanding: (name, universityId) =>
      Promise.resolve(
        ranking(name).find((s) => s.universityId === universityId) ?? null,
      ),
    invalidate: () => Promise.resolve(),
  };
}
