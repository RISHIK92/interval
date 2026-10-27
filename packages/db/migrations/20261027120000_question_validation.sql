-- migrate:up
-- The validator (Q-1, Q-P2-07, P2-W8-S02): a second, blind call answers each pending
-- question without its key; its answer is kept with the verdict, so a reviewer (Q-2)
-- can see why a question was rejected.
alter table question
  add column validator_model text,
  add column validator_answer smallint check (validator_answer between 0 and 3),
  add column validated_at timestamptz,
  add constraint question_validated_together check (
    (validator_model is null) = (validator_answer is null)
    and (validator_answer is null) = (validated_at is null)
  );

-- migrate:down
alter table question
  drop constraint question_validated_together,
  drop column validated_at,
  drop column validator_answer,
  drop column validator_model;
