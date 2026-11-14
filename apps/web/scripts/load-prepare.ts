// P5-W34-S02 (LOAD-4, Q-P5-21): the battles a window-start load test plays. Makes N local
// test players and puts them, 4 to a room, in battles on one problem, as a window's start
// would (startBattle, handed to game server 0), and writes them as JSON for
// scripts/load/window-start.js (k6). Local databases only, as game:battle: a hostname
// check, so a remote database tunnelled to localhost would pass it.
import { writeFileSync } from "node:fs";
import { S3Client } from "@aws-sdk/client-s3";
import { Redis } from "ioredis";
import { sql } from "kysely";
import { filesEnv } from "../src/env";
import { startBattle } from "../src/server/battles";
import { createDb } from "../src/server/adapters/kysely";
import { kyselyMatches } from "../src/server/adapters/kysely-matches";
import { kyselyProblemStore } from "../src/server/adapters/kysely-problems";
import { s3Files } from "../src/server/adapters/s3-files";
import { valkeyMatchHandoff } from "../src/server/adapters/valkey-match-handoff";

const url = process.env["DATABASE_URL"];
const valkey = process.env["VALKEY_URL"];
const [slug, count, out] = process.argv.slice(2);
const players = Number(count);
if (
  url === undefined ||
  valkey === undefined ||
  slug === undefined ||
  out === undefined ||
  !Number.isInteger(players) ||
  players < 2 ||
  players > 2000
) {
  console.error(
    "usage: pnpm load:prepare <problem slug> <players, 2-2000> <out.json>  (DATABASE_URL, VALKEY_URL from .env)",
  );
  process.exit(1);
}
const host = new URL(url).hostname;
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
  console.error(`refusing: ${host} isn't a local database`);
  process.exit(1);
}
const config = filesEnv();
const files = s3Files(
  new S3Client({
    region: config.AWS_REGION,
    ...(config.S3_ENDPOINT === undefined
      ? {}
      : { endpoint: config.S3_ENDPOINT, forcePathStyle: true }),
  }),
  config.PRIVATE_CONTENT_BUCKET,
);
const db = createDb(url);
const redis = new Redis(valkey, { maxRetriesPerRequest: 1 });
try {
  // The test players: one invite code, unrated users named load-<run>-<n>.
  const run = Date.now().toString(36);
  const code = await db
    .insertInto("invite_code")
    .values({
      code: `LOAD${run.toUpperCase()}`,
      beta_group: "developer",
      max_uses: players,
      expires_at: sql<Date>`now() + interval '1 day'`,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  const ids = Array.from(
    { length: players },
    (_, n) => `load-${run}-${String(n)}`,
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
  const deps = {
    store: kyselyProblemStore(db),
    files,
    matches: kyselyMatches(db),
    handoff: valkeyMatchHandoff(redis),
  };
  const battles: { matchId: string; players: string[] }[] = [];
  for (let i = 0; i < ids.length; i += 4) {
    const room = ids.slice(i, i + 4);
    // Unrated: a load test moves nobody's rating.
    battles.push({
      matchId: await startBattle(deps, 0, slug, room, { unrated: true }),
      players: room,
    });
  }
  writeFileSync(out, JSON.stringify({ slug, battles }, null, 2));
  console.log(
    `${String(battles.length)} battles, ${String(players)} players: ${out}`,
  );
} finally {
  await db.destroy();
  redis.disconnect();
}
