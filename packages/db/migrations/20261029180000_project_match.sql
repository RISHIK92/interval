-- migrate:up
-- P2-W12-S04 (REC-1, Q-P2-43): a candidate's concepts that the user's connected
-- projects map to. Owner: weighted like the comparable signal (goal_match, whatever
-- it is now), tunable on the admin ranking page.
insert into ranking_config (key, value, note)
select 'weight.project_match', value,
  'the item has a concept the user''s connected projects use'
from ranking_config where key = 'weight.goal_match';

-- migrate:down
delete from ranking_config where key = 'weight.project_match';
