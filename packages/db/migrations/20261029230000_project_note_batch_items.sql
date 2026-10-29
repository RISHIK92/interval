-- migrate:up
-- Project notes ride the question batches (Q-P2-46, AI-4, OPS-4): a combined batch
-- holds drafts or validations plus users' project notes. Each note item remembers
-- whose note it is and the repositories it was asked about, so a reply is saved only
-- while they still match, and its share of the batch's cost goes to that user.
create table project_note_batch_item (
  batch_id text not null references question_batch (id) on delete cascade,
  custom_id text not null,
  user_id text not null references app_user (id) on delete cascade,
  content_item_id bigint not null references content_item (id) on delete cascade,
  repositories text[] not null,
  prompt_version smallint not null,
  -- set when collected: saved, broken (a reply that broke a rule), error (the provider
  -- failed it), skipped (the user's matching repositories changed meanwhile)
  result text check (result in ('saved', 'broken', 'error', 'skipped')),
  primary key (batch_id, custom_id)
);
create index project_note_batch_item_user on project_note_batch_item (user_id);

-- migrate:down
drop table project_note_batch_item;
