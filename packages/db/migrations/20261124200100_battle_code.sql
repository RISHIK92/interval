-- migrate:up
-- Q-WD-17 (owner, 2026-11-23): one file per language, autosaved on the server. A battle
-- player's code in each language, saved by the web app a couple of seconds after each
-- edit while the battle is open, and restored on a reload or another device. It lives
-- as long as its match. Fair-play snapshots (battle_snapshot) are apart and unchanged.
create table battle_code (
  match_id uuid not null references game_match (id) on delete cascade,
  user_id text not null references app_user (id) on delete cascade,
  language text not null check (length(language) between 1 and 20),
  code text not null check (octet_length(code) <= 262144),
  saved_at timestamptz not null default now(),
  primary key (match_id, user_id, language)
);
create index battle_code_user on battle_code (user_id);

-- migrate:down
drop table battle_code;
