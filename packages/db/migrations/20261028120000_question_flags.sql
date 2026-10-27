-- migrate:up
-- Flagging a question (Q-2, §7, Q-P2-18, P2-W9-S07): a user who answered a question can
-- flag it with a reason, once. A flag takes a live question out of quizzes (status
-- flagged) and queues it for spot check at once; an admin's Keep puts it back
-- (P2-W8-S03). Kept as the record behind the "under 2% flagged" metric.
create type flag_reason as enum ('wrong_key', 'unclear', 'not_in_section', 'other');

create table question_flag (
  user_id text not null references app_user (id) on delete cascade,
  question_id bigint not null references question (id) on delete cascade,
  reason flag_reason not null,
  flagged_at timestamptz not null default now(),
  primary key (user_id, question_id)
);
create index question_flag_question on question_flag (question_id);

-- migrate:down
drop table question_flag;
drop type flag_reason;
