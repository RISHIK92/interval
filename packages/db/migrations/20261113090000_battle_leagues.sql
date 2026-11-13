-- migrate:up
-- P5-W33 (§6.2; Q-P5-20): the AI league. A problem belongs to a league's pool; a
-- window registration and its grouping are per league (same times).
alter table lld_problem add column league text not null default 'human'
  check (league in ('human', 'ai'));

alter table battle_window_registration add column league text not null default 'human'
  check (league in ('human', 'ai'));
alter table battle_window drop constraint battle_window_pkey;
alter table battle_window add column league text not null default 'human'
  check (league in ('human', 'ai'));
alter table battle_window add primary key (window_at, league);

-- §6.7 (Q-P5-20): battle season boards' final standings, per league and rating kind,
-- kept at the season close as quick games' are (season_standing).
create table battle_season_standing (
  season text not null check (season ~ '^[0-9]{4}-[0-9]{2}$'),
  user_id text not null references app_user (id) on delete cascade,
  league text not null check (league in ('human', 'ai')),
  kind text not null check (kind in ('duel', 'room')),
  rating double precision not null,
  primary key (season, league, kind, user_id)
);

-- migrate:down
drop table battle_season_standing;
-- One grouping per window again: the AI league's go with it.
delete from battle_window where league = 'ai';
alter table battle_window drop constraint battle_window_pkey;
alter table battle_window drop column league;
alter table battle_window add primary key (window_at);
alter table battle_window_registration drop column league;
alter table lld_problem drop column league;
