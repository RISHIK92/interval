-- migrate:up
-- Q-WD-17 (owner, 2026-11-23; costs ×10, owner, 2026-11-24): LLD battle hints cost
-- points (Nudge 10, Approach 30, Code sketch 60), taken off the best submission's points
-- by the game server. The result records what a player's hints cost (already off
-- `total`), for the results page.
alter table game_match_player
  add column hint_cost smallint not null default 0 check (hint_cost between 0 and 100);

-- migrate:down
alter table game_match_player drop column hint_cost;
