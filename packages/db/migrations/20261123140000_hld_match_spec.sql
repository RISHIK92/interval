-- migrate:up
-- ADR-0050 §6: a match records the spec version its variant was validated under, and
-- rebuilds its problem under it, so replays, disputes and appeals re-run it as played.
-- Every match before spec 2.0 was drawn on 1.0: the default fills them, then goes, so a
-- new match must say which version it was drawn on.
alter table hld_match add column spec text not null default '1.0';
alter table hld_match alter column spec drop default;

-- migrate:down
alter table hld_match drop column spec;
