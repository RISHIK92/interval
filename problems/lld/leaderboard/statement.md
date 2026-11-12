# Leaderboard

> PROVISIONAL (P5-W30-S04): written during the build; the owner reviews it before launch.

Build a leaderboard that ranks players by their total points.

- `Leaderboard()`: starts empty.
- `add(player, points)`: adds positive points to the player's total (a new player starts
  at 0) and returns the new total. Points of 0 or less fail and change nothing.
- `top(k)`: up to `k` players, best first; fewer when there are fewer players. A
  negative `k` fails.
- `rank(player)`: the player's 1-based position, or null for an unknown player.
- `remove(player)`: removes the player and returns true, or returns false when there's
  no such player. A removed player who scores again starts from 0.

The order is by total, highest first; players with equal totals are ordered by name.
Names are printable ASCII, compared character by character by their code (so `"Bo"` comes before `"al"`, and `"al"` before
`"bo"`). Totals stay within ±2^53.

Several threads may add points at once (JavaScript and TypeScript: interleaved async
calls). Every completed call must count.
