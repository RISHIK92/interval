> PROVISIONAL: drafted by Claude for the owner's review (Q-WD-17).

## Nudge

When two players have the same total, which one comes first, and does your language's default string comparison agree with the statement?

## Approach

Keep a map from player to total under one lock, and derive the order when it is asked for: sort the players by total, highest first, then by name compared by character code (not a locale-aware comparison). `top` and `rank` both read that one order, so they can never disagree. `remove` deletes the entry entirely, so a returning player starts from 0.

## Code sketch

```text
class Leaderboard
  totals: map player -> total
  lock

  ordered() -> list<string>
    // TODO: players sorted by (-total, name), names by character code
  add(player, points) -> int
    // TODO: reject points <= 0; add to the total (a new player starts at 0)
  top(k) -> list<string>
    // TODO: reject a negative k; the first k of ordered()
  rank(player) -> optional<int>
    // TODO: null when unknown, else the 1-based position in ordered()
  remove(player) -> bool
    // TODO: delete the player; whether they were there
```
