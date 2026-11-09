-- migrate:up
-- P4-W20-S03 (§5D): the app's reader finishes a moment by itself once its section has
-- been read through.
alter type finish_method add value 'auto';

-- migrate:down
-- Postgres can't drop an enum value; rebuild the type without it (no auto rows may
-- remain).
delete from user_moment_finished where method = 'auto';
delete from user_article_finished where method = 'auto';
alter type finish_method rename to finish_method_old;
create type finish_method as enum ('return_prompt', 'mark_done');
alter table user_moment_finished alter column method type finish_method
  using method::text::finish_method;
alter table user_article_finished alter column method type finish_method
  using method::text::finish_method;
drop type finish_method_old;
