-- migrate:up
-- Generated estimation questions (P3-W13-S03b, Q-1, Q-P3-05): the question model also
-- drafts an estimate where a moment states the number. The validator answers it blind
-- with a number, kept beside its verdict as the choice validator's index is (Q-2).
alter table question
  add column validator_estimate double precision
    check (validator_estimate > 0 and validator_estimate < 'Infinity'),
  drop constraint question_validated_together,
  add constraint question_validated_together check (
    (validator_model is null) = (validated_at is null)
    and (validator_model is null) = (validator_answer is null and validator_estimate is null)
    and (validator_answer is null or validator_estimate is null)
  ),
  add constraint question_validator_estimate_shape
    check (validator_estimate is null or kind = 'estimate');

-- A moment's estimate is drafted apart from its multiple-choice pair, so each kind has
-- its own slots and redrafting one never retires the other.
drop index question_one_per_slot;
create unique index question_one_per_slot on question (moment_id, kind, ordinal)
  where status <> 'retired';

-- Which kind a batch request drafts or validates.
alter table question_batch_item add column kind question_kind not null default 'choice';

-- What a moment's estimate was last drafted from, kept even when the passage stated no
-- number, so the same text is asked once (AI-4).
create table question_estimate_drafted (
  moment_id bigint primary key references moment (id) on delete cascade,
  content_hash text not null
);

-- migrate:down
drop table question_estimate_drafted;
delete from question where kind = 'estimate' and moment_id is not null;
delete from question_batch_item where kind = 'estimate';
alter table question_batch_item drop column kind;
drop index question_one_per_slot;
create unique index question_one_per_slot on question (moment_id, ordinal)
  where status <> 'retired';
alter table question
  drop constraint question_validator_estimate_shape,
  drop constraint question_validated_together,
  drop column validator_estimate,
  add constraint question_validated_together check (
    (validator_model is null) = (validator_answer is null)
    and (validator_answer is null) = (validated_at is null)
  );
