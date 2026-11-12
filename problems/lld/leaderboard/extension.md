# Leaderboard: the players around you (extension round)

> PROVISIONAL (P5-W31-S02c): written during the build; the owner reviews it before launch.

Players want to see who's near them, not just the top.

- `around(player, radius)`: the players ranked within `radius` places of `player`, above
  and below, including the player, best first (the same order as `top`). Near the top or
  bottom there are fewer. A negative radius fails (checked first, for any player); an
  unknown player gives an empty list.
