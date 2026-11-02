import { randomUUID } from "node:crypto";
import type { DB } from "@interval/db";
import { Redis } from "ioredis";
import { sql, type Transaction } from "kysely";
import { afterAll, expect, test, vi } from "vitest";
import type { Leaderboards } from "../ports";
import { createDb } from "./kysely";
import { mergeGuest } from "./kysely-guest-merge";
import { memoryLeaderboards, valkeyLeaderboards } from "./valkey-leaderboards";

// P3-W14-S01 (CACHE-3, §6.7; owner, 2026-11-02): boards in Valkey sorted sets, rows in
// Postgres the truth; a player's score on a board is the total of their games on it.
const connectionString = process.env["DATABASE_URL"];
const valkeyUrl = process.env["VALKEY_URL"];
if (connectionString === undefined || valkeyUrl === undefined)
  throw new Error("DATABASE_URL and VALKEY_URL must be set");
const db = createDb(connectionString);
const redis = new Redis(valkeyUrl);

afterAll(async () => {
  await db.destroy();
  redis.disconnect();
});

// Daily days are past ones: other suites clear today's and later sets as they run.
// A game on `board` ("daily:<day>", "sprint:<ISO week>", "estimation:<ISO week>", or
// "none" for a review), played by `userId`.
type Harness = {
  boards: Leaderboards;
  players(count: number): Promise<string[]>;
  game(userId: string, board: string, finished?: boolean): Promise<string>;
  // P3-W14-S02: the player's country now.
  country(userId: string, code: string): Promise<void>;
  // P3-W14-S04: the player's university now, by a name; its id.
  university(userId: string, name: string): Promise<string>;
};

async function contract(h: Harness): Promise<void> {
  const [a, b, c, d] = await h.players(4);
  if (a === undefined || b === undefined || c === undefined || d === undefined)
    throw new Error("players");
  const week = "sprint:2091-W02";
  await h.country(a, "IN");
  await h.country(b, "IN");
  await h.country(c, "DE");
  const one = await h.university(a, "One");
  await h.university(b, "One");
  await h.university(d, "One");
  const two = await h.university(c, "Two");

  // A week's games add up; recording one again (LOAD-5) changes nothing.
  const first = await h.game(a, week);
  const second = await h.game(a, week);
  await h.boards.record(a, first, 3);
  await h.boards.record(a, first, 3);
  await h.boards.record(a, second, 4);
  expect(await h.boards.standing(week, a)).toEqual({
    userId: a,
    score: 7,
    rank: 1,
  });

  // Boards stay apart: the next week, estimation rounds, a daily.
  await h.boards.record(a, await h.game(a, "sprint:2091-W03"), 5);
  await h.boards.record(a, await h.game(a, "estimation:2091-W02"), 250);
  await h.boards.record(a, await h.game(a, "daily:1991-01-10"), 380);
  expect(await h.boards.standing(week, a)).toMatchObject({ score: 7 });
  expect(await h.boards.standing("sprint:2091-W03", a)).toMatchObject({
    score: 5,
  });
  expect(await h.boards.standing("estimation:2091-W02", a)).toMatchObject({
    score: 250,
  });
  expect(await h.boards.standing("daily:1991-01-10", a)).toMatchObject({
    score: 380,
  });

  // Equal totals share a rank, ordered by player; the next rank skips.
  await h.boards.record(b, await h.game(b, week), 7);
  await h.boards.record(c, await h.game(c, week), 9);
  const [low, high] = [a, b].sort();
  expect(await h.boards.top(week, 10)).toEqual([
    { userId: c, score: 9, rank: 1 },
    { userId: high, score: 7, rank: 2 },
    { userId: low, score: 7, rank: 2 },
  ]);
  expect(await h.boards.top(week, 1)).toEqual([
    { userId: c, score: 9, rank: 1 },
  ]);
  expect(await h.boards.standing(week, b)).toEqual({
    userId: b,
    score: 7,
    rank: 2,
  });

  // Not on the board; nothing recorded for another's game, an unfinished one, or one
  // that isn't a game.
  expect(await h.boards.standing(week, d)).toBeNull();
  await h.boards.record(d, first, 50);
  await h.boards.record(d, await h.game(d, week, false), 50);
  await h.boards.record(d, await h.game(d, "none"), 50);
  expect(await h.boards.standing(week, d)).toBeNull();
  expect(await h.boards.standing(week, a)).toMatchObject({ score: 7 });
  expect(await h.boards.top("sprint:2091-W09", 10)).toEqual([]);

  // P3-W14-S02: a country's board has only its players, ranked among themselves.
  expect(await h.boards.top(week, 10, { country: "IN" })).toEqual([
    { userId: high, score: 7, rank: 1 },
    { userId: low, score: 7, rank: 1 },
  ]);
  expect(await h.boards.standing(week, c, { country: "IN" })).toBeNull();
  expect(await h.boards.standing(week, c, { country: "DE" })).toEqual({
    userId: c,
    score: 9,
    rank: 1,
  });
  expect(await h.boards.top(week, 10, { country: "FR" })).toEqual([]);
  // A player with no country is on the global board only.
  await h.boards.record(d, await h.game(d, "sprint:2091-W03"), 6);
  expect(await h.boards.top("sprint:2091-W03", 10)).toEqual([
    { userId: d, score: 6, rank: 1 },
    { userId: a, score: 5, rank: 2 },
  ]);
  expect(await h.boards.top("sprint:2091-W03", 10, { country: "IN" })).toEqual([
    { userId: a, score: 5, rank: 1 },
  ]);

  // P3-W14-S04: a university's board has only its players, ranked among themselves.
  expect(await h.boards.top(week, 10, { university: one })).toEqual([
    { userId: high, score: 7, rank: 1 },
    { userId: low, score: 7, rank: 1 },
  ]);
  expect(await h.boards.standing(week, c, { university: one })).toBeNull();
  expect(await h.boards.standing(week, c, { university: two })).toMatchObject({
    rank: 1,
  });
  // Universities ranked by their players' average (Q-P3-10; owner, 2026-11-02): only
  // players with a score count (d, of One, didn't play this week), and one player is
  // enough to be ranked.
  expect(await h.boards.universities(week, 10)).toEqual([
    { universityId: two, score: 9, rank: 1 },
    { universityId: one, score: 7, rank: 2 },
  ]);
  expect(await h.boards.universities(week, 1)).toEqual([
    { universityId: two, score: 9, rank: 1 },
  ]);
  expect(await h.boards.universityStanding(week, one)).toEqual({
    universityId: one,
    score: 7,
    rank: 2,
  });
  expect(await h.boards.universityStanding("sprint:2091-W09", one)).toBeNull();
  // d and a both played W03: One's average is 5.5, not a whole number.
  expect(await h.boards.universities("sprint:2091-W03", 10)).toEqual([
    { universityId: one, score: 5.5, rank: 1 },
  ]);
  // Equal averages share a rank, ordered by university as Valkey orders members.
  await h.boards.record(c, await h.game(c, "daily:1991-01-10"), 380);
  const [lowU, highU] = [one, two].sort();
  expect(await h.boards.universities("daily:1991-01-10", 10)).toEqual([
    { universityId: highU, score: 380, rank: 1 },
    { universityId: lowU, score: 380, rank: 1 },
  ]);
}

test("the in-memory fake keeps the contract", async () => {
  const games = new Map<
    string,
    { userId: string; board: string | null; finished: boolean }
  >();
  const countries = new Map<string, string>();
  const universities = new Map<string, string>();
  let n = 0;
  await contract({
    boards: memoryLeaderboards(games, countries, universities),
    university: (userId, name) => {
      universities.set(userId, `u-${name}`);
      return Promise.resolve(`u-${name}`);
    },
    country: (userId, code) => {
      countries.set(userId, code);
      return Promise.resolve();
    },
    players: (count) =>
      Promise.resolve(Array.from({ length: count }, () => randomUUID())),
    game: (userId, board, finished = true) => {
      n += 1;
      games.set(String(n), {
        userId,
        board: board === "none" ? null : board,
        finished,
      });
      return Promise.resolve(String(n));
    },
  });
});

class Rollback extends Error {}

async function inRollback(
  body: (trx: Transaction<DB>, prefix: string) => Promise<void>,
): Promise<void> {
  const prefix = `test-board-${randomUUID()}:`;
  try {
    await expect(
      db.transaction().execute(async (trx) => {
        await body(trx, prefix);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  } finally {
    const keys = await redis.keys(`${prefix}*`);
    if (keys.length > 0) await redis.del(...keys);
  }
}

async function players(
  trx: Transaction<DB>,
  count: number,
  anonymous = false,
): Promise<string[]> {
  const code = await trx
    .insertInto("invite_code")
    .values({
      code: `BOARD${randomUUID().slice(0, 8).toUpperCase()}`,
      beta_group: "developer",
      max_uses: 10,
      expires_at: sql<Date>`now() + interval '1 day'`,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const ids = Array.from({ length: count }, () => `board-${randomUUID()}`);
  await trx
    .insertInto("app_user")
    .values(
      ids.map((id) => ({
        id,
        name: anonymous ? "" : "Ada",
        email: `${id}@board.example.test`,
        is_anonymous: anonymous,
        beta_group: "developer" as const,
        invite_code_id: code.id,
      })),
    )
    .execute();
  return ids;
}

// An attempt that lands on `board`: a daily on its day, a sprint or estimation round
// started at `at` (else the Monday of the board's week).
async function game(
  trx: Transaction<DB>,
  userId: string,
  board: string,
  finished = true,
  at?: string,
): Promise<string> {
  const [kind, period] = board.split(/:(.*)/);
  const done = finished ? sql`now()` : sql`null`;
  const { rows } =
    kind === "daily"
      ? await sql<{ id: string }>`with day as (
            insert into daily_challenge (day) values (${period}::date)
            on conflict do nothing)
          insert into quiz_attempt (user_id, daily_day, started_at, ends_at, finished_at)
          values (${userId}, ${period}::date, now() - interval '1 hour', now(), ${done})
          returning id`.execute(trx)
      : kind === "none"
        ? await sql<{ id: string }>`insert into quiz_attempt
              (user_id, review, finished_at) values (${userId}, true, now())
            returning id`.execute(trx)
        : await sql<{ id: string }>`insert into quiz_attempt
              (user_id, sprint, estimation, started_at, ends_at, finished_at)
            select ${userId}, true, ${kind === "estimation"}, s, s + interval '1 minute',
                   ${done}
            from (select coalesce(${at ?? null}::timestamptz,
                    to_date(${period ?? ""}, 'IYYY-"W"IW')::timestamp at time zone 'utc')
                  as s) start
            returning id`.execute(trx);
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("no attempt");
  return id;
}

test("the Valkey adapter keeps the contract", async () => {
  await inRollback(async (trx, prefix) => {
    await contract({
      boards: valkeyLeaderboards(trx, redis, prefix),
      players: (count) => players(trx, count),
      game: (userId, board, finished) => game(trx, userId, board, finished),
      country: (userId, code) => country(trx, userId, code),
      university: (userId, name) => university(trx, userId, name),
    });
  });
});

async function country(
  trx: Transaction<DB>,
  userId: string,
  code: string | null,
): Promise<void> {
  await sql`insert into player_country (user_id, country) values (${userId}, ${code})
    on conflict (user_id) do update set country = excluded.country`.execute(
    trx,
  );
}

// A typed university by that name (made once), and the player in it.
async function university(
  trx: Transaction<DB>,
  userId: string,
  name: string,
): Promise<string> {
  const typed = `board-test ${name}`;
  await sql`insert into university (name, listed) values (${typed}, false)
    on conflict (lower(name)) where not listed do nothing`.execute(trx);
  const { id } = await trx
    .selectFrom("university")
    .select("id")
    .where("name", "=", typed)
    .where("listed", "=", false)
    .executeTakeFirstOrThrow();
  await sql`insert into player_university (user_id, university_id)
    values (${userId}, ${id})
    on conflict (user_id) do update set university_id = excluded.university_id`.execute(
    trx,
  );
  return id;
}

test("after a change of university the player's totals and the averages move", async () => {
  await inRollback(async (trx, prefix) => {
    const boards = valkeyLeaderboards(trx, redis, prefix);
    const [a, b, c] = await players(trx, 3);
    if (a === undefined || b === undefined || c === undefined)
      throw new Error("players");
    const week = "estimation:2091-W11";
    const one = await university(trx, a, "Move One");
    await university(trx, b, "Move One");
    const two = await university(trx, c, "Move Two");
    await boards.record(a, await game(trx, a, week), 300);
    await boards.record(b, await game(trx, b, week), 100);
    await boards.record(c, await game(trx, c, week), 150);
    // All read, so all are cached.
    expect(await boards.universities(week, 10)).toEqual([
      { universityId: one, score: 200, rank: 1 },
      { universityId: two, score: 150, rank: 2 },
    ]);
    expect(await boards.top(week, 10, { university: two })).toHaveLength(1);
    // A game recorded while cached updates the player's board and the average at once.
    await boards.record(b, await game(trx, b, week), 100);
    expect(await boards.universityStanding(week, one)).toEqual({
      universityId: one,
      score: 250,
      rank: 1,
    });
    expect(await boards.standing(week, b, { university: one })).toEqual({
      userId: b,
      score: 200,
      rank: 2,
    });
    // An average can fall: a new player of Two scores low while it's cached.
    const [e] = await players(trx, 1);
    if (e === undefined) throw new Error("players");
    await university(trx, e, "Move Two");
    await boards.record(e, await game(trx, e, week), 50);
    expect(await boards.universityStanding(week, two)).toMatchObject({
      score: 100,
    });
    // a moves to Two: One is b alone, Two averages a, c and e.
    await university(trx, a, "Move Two");
    await boards.invalidate(a, [{ university: one }]);
    expect(await boards.universities(week, 10)).toEqual([
      { universityId: one, score: 200, rank: 1 },
      { universityId: two, score: 500 / 3, rank: 2 },
    ]);
    expect(await boards.top(week, 10, { university: one })).toEqual([
      { userId: b, score: 200, rank: 1 },
    ]);
    expect(await boards.top(week, 10, { university: two })).toEqual([
      { userId: a, score: 300, rank: 1 },
      { userId: c, score: 150, rank: 2 },
      { userId: e, score: 50, rank: 3 },
    ]);
    expect(await boards.universities(week, 0)).toEqual([]);
    // One removed by the owner: b has none, and One leaves the ranking.
    await sql`delete from university where id = ${one}`.execute(trx);
    await boards.invalidate(b, [{ university: one }]);
    expect(await boards.universities(week, 10)).toEqual([
      { universityId: two, score: 500 / 3, rank: 1 },
    ]);
  });
});

test("after a change of country the player's totals move to the new country's boards", async () => {
  await inRollback(async (trx, prefix) => {
    const boards = valkeyLeaderboards(trx, redis, prefix);
    const [a, b] = await players(trx, 2);
    if (a === undefined || b === undefined) throw new Error("players");
    const week = "estimation:2091-W10";
    await country(trx, a, "IN");
    await country(trx, b, "IN");
    await boards.record(a, await game(trx, a, week), 200);
    await boards.record(b, await game(trx, b, week), 100);
    // Both read, so both are cached.
    expect(await boards.top(week, 10, { country: "IN" })).toHaveLength(2);
    expect(await boards.top(week, 10, { country: "BR" })).toEqual([]);
    // A game recorded while the country's board is cached joins it at once.
    await boards.record(a, await game(trx, a, week), 50);
    expect(await boards.standing(week, a, { country: "IN" })).toEqual({
      userId: a,
      score: 250,
      rank: 1,
    });
    await country(trx, a, "BR");
    await boards.invalidate(a, [{ country: "IN" }]);
    expect(await boards.top(week, 10, { country: "IN" })).toEqual([
      { userId: b, score: 100, rank: 1 },
    ]);
    expect(await boards.top(week, 10, { country: "BR" })).toEqual([
      { userId: a, score: 250, rank: 1 },
    ]);
    // Removed: on the global board only.
    await country(trx, a, null);
    await boards.invalidate(a, [{ country: "BR" }]);
    expect(await boards.top(week, 10, { country: "BR" })).toEqual([]);
    expect(await boards.standing(week, a)).toMatchObject({ rank: 1 });
  });
});

test("a board lost from Valkey is rebuilt from Postgres on its next read", async () => {
  await inRollback(async (trx, prefix) => {
    const boards = valkeyLeaderboards(trx, redis, prefix);
    const [a, b] = await players(trx, 2);
    if (a === undefined || b === undefined) throw new Error("players");
    const board = "estimation:2091-W05";
    await boards.record(a, await game(trx, a, board), 120);
    await boards.record(b, await game(trx, b, board), 300);
    const before = await boards.top(board, 10);
    await redis.del(...(await redis.keys(`${prefix}*`)));
    expect(await boards.top(board, 10)).toEqual(before);
    await redis.del(...(await redis.keys(`${prefix}*`)));
    expect(await boards.standing(board, a)).toEqual({
      userId: a,
      score: 120,
      rank: 2,
    });
  });
});

test("weeks are ISO weeks in UTC, by when the game started", async () => {
  await inRollback(async (trx, prefix) => {
    const boards = valkeyLeaderboards(trx, redis, prefix);
    const [a] = await players(trx, 1);
    if (a === undefined) throw new Error("players");
    for (const [at, score] of [
      ["2026-11-08T23:59:59Z", 1], // Sunday: week 45
      ["2026-11-09T00:00:00Z", 2], // Monday: week 46
      ["2026-11-09T00:30:00+05:30", 4], // Sunday 19:00 UTC: week 45
      ["2027-01-01T12:00:00Z", 8], // A Friday in 2026's week 53
      ["2027-01-04T00:00:00Z", 16], // 2027's first Monday
    ] as const)
      await boards.record(a, await game(trx, a, "sprint:x", true, at), score);
    const total = async (board: string) =>
      (await boards.standing(board, a))?.score;
    expect(await total("sprint:2026-W45")).toBe(5);
    expect(await total("sprint:2026-W46")).toBe(2);
    expect(await total("sprint:2026-W53")).toBe(8);
    expect(await total("sprint:2027-W01")).toBe(16);
  });
});

test("after a guest merge the account's boards carry the guest's games, and no guest", async () => {
  await inRollback(async (trx, prefix) => {
    const boards = valkeyLeaderboards(trx, redis, prefix);
    const [guest] = await players(trx, 1, true);
    const [account] = await players(trx, 1);
    if (guest === undefined || account === undefined)
      throw new Error("players");
    const week = "sprint:2091-W07";
    await boards.record(guest, await game(trx, guest, week), 6);
    const school = await university(trx, account, "Merge");
    await boards.record(account, await game(trx, account, week), 4);
    // Read first, so the stale boards are cached.
    expect(await boards.top(week, 10)).toHaveLength(2);
    expect(await boards.universities(week, 10)).toHaveLength(1);
    expect(await boards.top(week, 10, { university: school })).toHaveLength(1);
    expect(await mergeGuest(trx, guest, account)).toBe(true);
    await boards.invalidate(account);
    expect(await boards.top(week, 10)).toEqual([
      { userId: account, score: 10, rank: 1 },
    ]);
    // P3-W14-S04: its university's board and average carry the guest's games too.
    expect(await boards.top(week, 10, { university: school })).toEqual([
      { userId: account, score: 10, rank: 1 },
    ]);
    expect(await boards.universities(week, 10)).toEqual([
      { universityId: school, score: 10, rank: 1 },
    ]);
  });
});

test("with Valkey down a game's score is still kept, and the board catches up", async () => {
  await inRollback(async (trx, prefix) => {
    const down = new Redis("redis://127.0.0.1:1", {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    down.on("error", () => undefined);
    const healthy = valkeyLeaderboards(trx, redis, prefix);
    const [a] = await players(trx, 1);
    if (a === undefined) throw new Error("players");
    const school = await university(trx, a, "Down");
    const board = "sprint:2091-W08";
    await healthy.record(a, await game(trx, a, board), 4);
    // Built and cached before the outage.
    expect(await healthy.standing(board, a)).toMatchObject({ score: 4 });
    expect(await healthy.universities(board, 10)).toMatchObject([{ score: 4 }]);
    expect(
      await healthy.standing(board, a, { university: school }),
    ).toMatchObject({ score: 4 });
    const written: string[] = [];
    const out = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk) => {
        written.push(String(chunk));
        return true;
      });
    const missed = await game(trx, a, board);
    await valkeyLeaderboards(trx, down, prefix).record(a, missed, 9);
    out.mockRestore();
    down.disconnect();
    expect(written.join("")).toContain("boards: write failed");
    // Kept in Postgres: the cached board is behind for at most the marker's life
    // (minutes, not the board's days) ...
    expect(await redis.ttl(`${prefix}built:${board}`)).toBeLessThanOrEqual(600);
    // ... and a repeat of the finish (LOAD-5) mends it at once.
    await healthy.record(a, missed, 9);
    expect(await healthy.standing(board, a)).toEqual({
      userId: a,
      score: 13,
      rank: 1,
    });
    expect(
      await healthy.standing(board, a, { university: school }),
    ).toMatchObject({ score: 13 });
    expect(await healthy.universities(board, 10)).toEqual([
      { universityId: school, score: 13, rank: 1 },
    ]);
  });
});

test("a board evicted while its marker stays is rebuilt, not shown empty", async () => {
  await inRollback(async (trx, prefix) => {
    const boards = valkeyLeaderboards(trx, redis, prefix);
    const [a] = await players(trx, 1);
    if (a === undefined) throw new Error("players");
    const board = "daily:1991-02-01";
    await boards.record(a, await game(trx, a, board), 300);
    expect(await boards.top(board, 10)).toHaveLength(1);
    await redis.del(`${prefix}${board}`);
    expect(await boards.top(board, 10)).toEqual([
      { userId: a, score: 300, rank: 1 },
    ]);
  });
});
