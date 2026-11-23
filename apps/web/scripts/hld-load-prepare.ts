// P6-W44 (LOAD-4, Q-P6-08): the round an HLD tournament load test plays. Makes N local
// test players, signed in (sessions signed with BETTER_AUTH_SECRET, as Better Auth's
// cookie is), enters and checks them into a tournament, and starts its first round through
// the real tournament code, then writes the players' matches, cookies and a design that
// passes for scripts/load/hld-round.js (k6). Local databases only: a hostname check, as
// load:prepare.
import { createHmac, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { FAMILIES, matchFamilies, POOL, variant } from "@interval/hld";
import { sql } from "kysely";
import { createDb } from "../src/server/adapters/kysely";
import { kyselyHldJudgements } from "../src/server/adapters/kysely-hld-judgements";
import { kyselyHldMatches } from "../src/server/adapters/kysely-hld-matches";
import { kyselyHldTournaments } from "../src/server/adapters/kysely-hld-tournaments";
import { nextRound } from "../src/server/hld-tournaments";

const url = process.env["DATABASE_URL"];
const secret = process.env["BETTER_AUTH_SECRET"];
const [count, out] = process.argv.slice(2);
const players = Number(count);
if (
  url === undefined ||
  secret === undefined ||
  out === undefined ||
  !Number.isInteger(players) ||
  players < 2 ||
  players > 2000
) {
  console.error(
    "usage: pnpm load:hld <players, 2-2000> <out.json>  (DATABASE_URL, BETTER_AUTH_SECRET from .env)",
  );
  process.exit(1);
}
const parsed = new URL(url);
const host = parsed.hostname;
// libpq honours a host in the query over the authority: refuse one, so the check holds.
if (
  !["localhost", "127.0.0.1", "::1", "[::1]"].includes(host) ||
  parsed.searchParams.has("host") ||
  parsed.searchParams.has("hostaddr")
) {
  console.error(`refusing: ${host} isn't a local database`);
  process.exit(1);
}

// Better Auth's session cookie: the token and its HMAC-SHA256, base64, URL-encoded.
const cookieFor = (token: string) =>
  `better-auth.session_token=${encodeURIComponent(
    `${token}.${createHmac("sha256", secret).update(token).digest("base64")}`,
  )}`;

const db = createDb(url);
try {
  const run = Date.now().toString(36);
  const code = await db
    .insertInto("invite_code")
    .values({
      code: `HLDLOAD${run.toUpperCase()}`,
      beta_group: "developer",
      max_uses: players,
      expires_at: sql<Date>`now() + interval '1 day'`,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const ids = Array.from(
    { length: players },
    (_, n) => `load-hld-${run}-${String(n)}`,
  );
  await db
    .insertInto("app_user")
    .values(
      ids.map((id) => ({
        id,
        name: id,
        email: `${id}@load.example.test`,
        beta_group: "developer" as const,
        invite_code_id: code.id,
      })),
    )
    .execute();
  const tokens = new Map(
    ids.map((id) => [id, randomBytes(24).toString("base64url")]),
  );
  await db
    .insertInto("auth_session")
    .values(
      ids.map((id) => ({
        id: `load-${randomBytes(12).toString("hex")}`,
        token: tokens.get(id) ?? "",
        user_id: id,
        expires_at: sql<Date>`now() + interval '1 day'`,
        updated_at: sql<Date>`now()`,
      })),
    )
    .execute();

  // A tournament on the first match family's first 8 pooled variants, starting now.
  const family = matchFamilies(FAMILIES)[0];
  const seeds = family === undefined ? [] : (POOL[family.slug]?.human ?? []);
  if (family === undefined || seeds.length < 8)
    throw new Error("not enough pooled variants");
  const tournaments = kyselyHldTournaments(db);
  const id = await tournaments.create(
    {
      name: `Load ${run}`,
      battleMode: "human",
      startsAt: new Date(Date.now() + 30 * 60_000),
      rounds: seeds.slice(0, 8).map((seed) => ({ family: family.slug, seed })),
    },
    ids[0] ?? "",
  );
  const now = new Date();
  for (const user of ids) {
    await tournaments.register(id, user);
    await tournaments.checkIn(id, user, now);
  }
  const started = await nextRound(
    {
      matches: kyselyHldMatches(db),
      judgements: kyselyHldJudgements(db),
      // Starting a round queues nothing: the judge is queued when designs are submitted,
      // by the web app under test.
      queue: {
        enqueue: () =>
          Promise.reject(new Error("nothing is queued while preparing")),
      },
      now: () => new Date(),
      random: Math.random,
      tournaments,
    },
    id,
  );
  if (started !== "started") throw new Error(`round 1 not started: ${started}`);
  const pairings = (await tournaments.pairings(id)).filter(
    (p) => p.matchId !== null,
  );
  const reference = variant(family, "human", seeds[0] ?? 0).reference;
  const seats = pairings.flatMap((p) =>
    [p.playerA, p.playerB].map((user) => ({
      matchId: p.matchId,
      cookie: cookieFor(tokens.get(user ?? "") ?? ""),
    })),
  );
  writeFileSync(
    out,
    JSON.stringify({ tournament: id, design: reference, seats }, null, 2),
  );
  console.log(
    `${String(pairings.length)} matches, ${String(seats.length)} players: ${out}`,
  );
} finally {
  await db.destroy();
}
