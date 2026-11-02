// P3-W15-S03 (ADR-0033, Q-P3-22): makes a live match for the given players, with its
// questions handed to game server 0, so a match can be played before matchmaking (W16)
// exists. Local databases only: a hostname check, so a remote database tunnelled to
// localhost would pass it; never point DATABASE_URL at one.
import { Redis } from "ioredis";
import { createDb } from "../src/server/adapters/kysely";
import { kyselyMatches } from "../src/server/adapters/kysely-matches";
import { valkeyMatchHandoff } from "../src/server/adapters/valkey-match-handoff";
import { startLiveMatch } from "../src/server/live";

const url = process.env["DATABASE_URL"];
const valkey = process.env["VALKEY_URL"];
const players = process.argv.slice(2);
if (url === undefined || valkey === undefined || players.length === 0) {
  console.error(
    "usage: pnpm game:match <userId> [userId...]  (DATABASE_URL and VALKEY_URL from .env)",
  );
  process.exit(1);
}
const host = new URL(url).hostname;
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
  console.error(`refusing: ${host} isn't a local database`);
  process.exit(1);
}
const db = createDb(url);
const redis = new Redis(valkey, { maxRetriesPerRequest: 1 });
try {
  const match = await startLiveMatch(
    kyselyMatches(db),
    valkeyMatchHandoff(redis),
    players,
  );
  console.log(match.id);
} finally {
  await db.destroy();
  redis.disconnect();
}
