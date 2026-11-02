// P3-W15-S02 (ADR-0033; owner, 2026-11-02): makes a live match on game server 0 for the
// given players, so tickets and sockets can be tried before matchmaking (W16) exists.
// Local databases only: a hostname check, so a remote database tunnelled to localhost
// would pass it; never point DATABASE_URL at one. Node runs this file as it is (src/'s
// extensionless imports don't load that way), so it writes the rows itself; W16
// matchmaking writes the same ones.
import pg from "pg";

const url = process.env["DATABASE_URL"];
const players = process.argv.slice(2);
if (url === undefined || players.length === 0) {
  console.error(
    "usage: pnpm game:match <userId> [userId...]  (DATABASE_URL from .env)",
  );
  process.exit(1);
}
const host = new URL(url).hostname;
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
  console.error(`refusing: ${host} isn't a local database`);
  process.exit(1);
}
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query("begin");
  const { rows } = await client.query<{ id: string }>(
    "insert into game_match (server_id) values (0) returning id",
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("no match made");
  await client.query(
    "insert into game_match_player (match_id, user_id) select $1, unnest($2::text[])",
    [id, players],
  );
  await client.query("commit");
  console.log(id);
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  await client.end();
}
