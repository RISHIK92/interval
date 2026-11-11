-- migrate:up
-- A section's sessions in a user's copy of a path (P2-W10-S05, Q-P2-23; ING-2): their
-- swapped moment while its rights allow it, else the approved one; a swap comes back if
-- its source does. One definition for the web (checkpoints.ts) and the worker's path
-- reminder (P4-W24-S01b), which the drift audit of 2026-11-11 found had its own copy
-- without the rights check (ARCH-2).
create function user_path_sessions(p_user text, p_section bigint)
returns table (ordinal smallint, moment_id bigint)
language sql stable as $$
  select ps.ordinal, coalesce(swapped.id, ps.moment_id) as moment_id
  from path_session ps
  left join lateral (
    select sm.id from user_path_session us
    join moment sm on sm.id = us.moment_id
    join content_item ci on ci.id = sm.content_item_id
    join source so on so.id = ci.source_id
    where us.user_id = p_user and us.section_id = ps.section_id
      and us.ordinal = ps.ordinal
      -- path-rights.ts ALLOWED
      and so.moments_enabled
      and so.rights_profile in ('full_text_internal', 'full_text_display')
      and ci.duplicate_of is null
  ) swapped on true
  where ps.section_id = p_section
$$;

-- migrate:down
drop function user_path_sessions(text, bigint);
