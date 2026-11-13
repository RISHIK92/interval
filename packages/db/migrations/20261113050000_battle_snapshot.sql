-- migrate:up
-- P5-W31-S04b (§6.9, DB-6, Q-P5-17): a battle player's code every 30 s, for review of a
-- fair-play flag. The code is in the private bucket at `key`; this row records it, so
-- pruning (90 days, or once the match's flags are decided) never lists the bucket.
create table battle_snapshot (
  match_id uuid not null references game_match (id) on delete cascade,
  user_id text not null references app_user (id) on delete cascade,
  taken_at timestamptz not null,
  language text not null,
  key text not null unique,
  -- The 25-second slot it was taken in: one per slot, so posts racing past the
  -- claim's gap check can't store more than the 30 s rhythm.
  slot bigint not null,
  primary key (match_id, user_id, taken_at),
  unique (match_id, user_id, slot)
);

-- migrate:down
drop table battle_snapshot;
