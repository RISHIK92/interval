-- migrate:up
-- Editing your path (§5F, C-25, Q-P2-23, P2-W10-S05): a user's own copy of the
-- approved path, which itself never changes. Their first reorder or skip copies the
-- path's order here (every section); a swap replaces one session's moment. A section
-- once skipped no longer holds the next ones back, even after an unskip brings its
-- checkpoint back (owner, 2026-10-28).
create table user_path_section (
  user_id text not null,
  path_id bigint not null,
  section_id bigint not null references path_section (id) on delete cascade,
  ordinal smallint not null check (ordinal >= 0),
  skipped_at timestamptz,
  unskipped_at timestamptz,
  primary key (user_id, section_id),
  foreign key (user_id, path_id) references user_path (user_id, path_id)
    on delete cascade,
  -- Deferred: a move swaps two sections' places in one transaction.
  constraint user_path_section_place unique (user_id, path_id, ordinal)
    deferrable initially deferred,
  check (unskipped_at is null or skipped_at is not null)
);

-- A swapped session goes back to the approved moment when its own is deleted.
create table user_path_session (
  user_id text not null references app_user (id) on delete cascade,
  section_id bigint not null,
  ordinal smallint not null,
  moment_id bigint not null references moment (id) on delete cascade,
  primary key (user_id, section_id, ordinal),
  foreign key (section_id, ordinal) references path_session (section_id, ordinal)
    on delete cascade
);

-- migrate:down
drop table user_path_session;
drop table user_path_section;
