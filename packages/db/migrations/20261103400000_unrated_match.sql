-- migrate:up
-- P3-W17-S03 (Q-P3-16; owner, 2026-11-03): a friend challenge is a private live match,
-- unrated: no rating or season board moves; its answers still count as evidence.
alter table game_match add column unrated boolean not null default false;

-- migrate:down
alter table game_match drop column unrated;
