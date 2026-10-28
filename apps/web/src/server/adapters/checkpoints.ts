import { type RawBuilder, sql } from "kysely";
import { ALLOWED } from "./path-rights";

// Checkpoints (§5F, Q-P2-26, P2-W10-S04), the rules the timeline and the quiz share.
type Ref = RawBuilder<unknown>;

// A section's checkpoint questions: live ones whose rights allow them (Q-1, ING-2),
// from its own readings (tier 0, in reading order), then on its live concepts (tier
// 1); a question in both is in its first tier.
export const checkpointQuestions = (section: Ref) => sql`
  select distinct on (id) id, tier, ro, qo from (
    select q.id, 0 as tier, ps.ordinal as ro, q.ordinal as qo
    from path_session ps
    join moment m on m.id = ps.moment_id
    join content_item ci on ci.id = m.content_item_id
    join source so on so.id = ci.source_id
    join question q on q.moment_id = m.id and q.status = 'live'
    where ps.section_id = ${section} and ${ALLOWED}
    union all
    select q.id, 1, 0, 0
    from path_section_concept pc
    join concept c on c.id = pc.concept_id and c.retired_at is null
    join question_concept qc on qc.concept_id = pc.concept_id
    join question q on q.id = qc.question_id and q.status = 'live'
    join moment m on m.id = q.moment_id
    join content_item ci on ci.id = m.content_item_id
    join source so on so.id = ci.source_id
    where pc.section_id = ${section} and ${ALLOWED}
  ) candidates
  order by id, tier, ro, qo
`;

// One of the user's checkpoints on the section passed (settled at its finish).
export const sectionPassed = (
  userId: string,
  section: Ref,
) => sql<boolean>`exists (
  select 1 from quiz_attempt a
  where a.user_id = ${userId} and a.path_section_id = ${section}
    and a.checkpoint_passed
)`;

// The first section is open; each next one once the one before it is passed.
export const sectionOpen = (
  userId: string,
  section: Ref,
) => sql<boolean>`coalesce((
  select ${sectionPassed(userId, sql`prev.id`)}
  from path_section cur
  join path_section prev on prev.path_id = cur.path_id and prev.ordinal < cur.ordinal
  where cur.id = ${section}
  order by prev.ordinal desc
  limit 1
), true)`;

// Every reading the user can open is finished: its rights allow it and its link
// works (ING-6; a broken one can't be read, so it doesn't hold the checkpoint back).
export const readingsDone = (
  userId: string,
  section: Ref,
) => sql<boolean>`not exists (
  select 1 from path_session ps
  join moment m on m.id = ps.moment_id
  join content_item ci on ci.id = m.content_item_id
  join source so on so.id = ci.source_id
  where ps.section_id = ${section} and ${ALLOWED} and ci.link_broken_at is null
    and not exists (
      select 1 from user_moment_finished f
      where f.user_id = ${userId} and f.moment_id = ps.moment_id
    )
)`;
