// P5-W31-S02b (§6.5, ADR-0033): makes an LLD battle on a loaded problem for the given
// players and hands it to the game server, so a battle can be played before
// matchmaking (W32) exists. Local databases only, as game:match: a hostname check, so a
// remote database tunnelled to localhost would pass it; never point DATABASE_URL at one.
import { S3Client } from "@aws-sdk/client-s3";
import { Redis } from "ioredis";
import { filesEnv } from "../src/env";
import { startBattle } from "../src/server/battles";
import { createDb } from "../src/server/adapters/kysely";
import { kyselyMatches } from "../src/server/adapters/kysely-matches";
import { kyselyProblemStore } from "../src/server/adapters/kysely-problems";
import { s3Files } from "../src/server/adapters/s3-files";
import { valkeyMatchHandoff } from "../src/server/adapters/valkey-match-handoff";

const url = process.env["DATABASE_URL"];
const valkey = process.env["VALKEY_URL"];
const [slug, ...players] = process.argv.slice(2);
if (
  url === undefined ||
  valkey === undefined ||
  slug === undefined ||
  players.length === 0
) {
  console.error(
    "usage: pnpm game:battle <problem slug> <userId> [userId...]  (DATABASE_URL and VALKEY_URL from .env)",
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
  console.log(
    await startBattle(
      {
        store: kyselyProblemStore(db),
        files,
        matches: kyselyMatches(db),
        handoff: valkeyMatchHandoff(redis),
      },
      // Game server 0, as game:match: one local server.
      0,
      slug,
      players,
    ),
  );
} finally {
  await db.destroy();
  redis.disconnect();
}
