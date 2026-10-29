-- migrate:up
-- A project line is made once per user, item, repository set and prompt version: a
-- reworded prompt (the repository is no longer named in the line, owner 2026-10-29)
-- asks again instead of keeping lines the old prompt wrote.
alter table project_note add column prompt_version smallint not null default 1;
alter table project_note
  drop constraint project_note_user_id_content_item_id_repositories_key;
alter table project_note
  add unique (user_id, content_item_id, repositories, prompt_version);

-- migrate:down
delete from project_note where prompt_version <> 1;
alter table project_note
  drop constraint project_note_user_id_content_item_id_repositories_prompt_ve_key;
alter table project_note add unique (user_id, content_item_id, repositories);
alter table project_note drop column prompt_version;
