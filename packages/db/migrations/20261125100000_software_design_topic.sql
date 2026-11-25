-- migrate:up
-- ADR-0049 (option 2, Q-WD-30): a fifth topic, software design, for the LLD practice
-- catalog's concepts. Concepts, practice problems, quizzes, review and mastery use it
-- now; onboarding and Profile offer it only once sources tagged with it have produced
-- reading (the web app's rule, not the schema's). if not exists: the value survives a
-- rollback (see down), so a re-run must not fail.
alter type topic add value if not exists 'software-design';

-- concept.topic is text with its own list (§2, C-32), apart from the enum.
alter table concept
  drop constraint concept_topic_check,
  add constraint concept_topic_check check (
    topic in ('system-design', 'databases', 'distributed-systems', 'backend', 'software-design')
  );

-- migrate:down
-- Postgres can't drop an enum value: the value stays, and only the concept list shrinks.
-- Reassign the software-design concepts' topic first, or this fails.
alter table concept
  drop constraint concept_topic_check,
  add constraint concept_topic_check check (
    topic in ('system-design', 'databases', 'distributed-systems', 'backend')
  );
