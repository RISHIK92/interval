-- migrate:up
-- The concepts a user's chosen goals point at (ADR-0015): the curated goal_concept set
-- for each goal, and for "get better at the stack I use" the concepts their projects'
-- technologies map to (P2-W12-S04). One definition in SQL, so the web (the Paths
-- page's "Fits your goal") doesn't restate the rule. The worker's ranking builds the
-- same set in Python from the same tables (rank.goal_sets); docs/progress.md lists
-- moving it onto this function.
create function user_goal_concepts(p_user_id text)
returns table (concept_id bigint)
language sql stable
as $$
  select c.id
  from user_preferences p
  cross join unnest(p.goals) g(goal)
  join goal_concept gc on gc.goal = g.goal
  join concept c on c.slug = gc.concept_slug and c.retired_at is null
  where p.user_id = p_user_id
  union
  select u.concept_id
  from user_preferences p
  cross join user_technology_concepts(p_user_id) u
  where p.user_id = p_user_id and 'stack-i-use' = any(p.goals)
$$;

-- migrate:down
drop function user_goal_concepts(text);
