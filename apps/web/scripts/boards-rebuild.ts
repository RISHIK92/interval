// P3-W14-S01 (CACHE-3): drops every leaderboard from Valkey. Postgres's board_score is
// the truth, and each board is rebuilt from it on its next read
// (src/server/adapters/valkey-leaderboards.ts, whose default key prefix this is).
import { Redis } from "ioredis";

const url = process.env["VALKEY_URL"];
if (url === undefined) {
  console.error("Set VALKEY_URL in .env");
  process.exit(1);
}
// Fails at once rather than retrying silently when Valkey is down.
const redis = new Redis(url, {
  maxRetriesPerRequest: 1,
  retryStrategy: () => null,
});
let dropped = 0;
for await (const keys of redis.scanStream({ match: "board:*", count: 500 })) {
  const batch = keys as string[];
  if (batch.length > 0) dropped += await redis.unlink(...batch);
}
console.log(
  `dropped ${String(dropped)} board keys; boards rebuild on their next read`,
);
redis.disconnect();
