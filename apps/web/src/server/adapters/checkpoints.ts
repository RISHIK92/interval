import { type RawBuilder, sql } from "kysely";
import { ALLOWED } from "./path-rights";

// Checkpoints (§5F, Q-P2-26, P2-W10-S04), the rules the timeline and the quiz share,
// over the user's own copy of the path (P2-W10-S05, Q-P2-23).
type Ref = RawBuilder<unknown>;

// A section's sessions in the user's copy: their swapped moment while its rights allow
// it (ING-2), else the approved one; a swap comes back if its source does.
export const sessions = (userId: string, section: Ref) => sql`
  select ps.ordinal, coalesce(swapped.id, ps.moment_id) as moment_id
  from path_session ps
  left join lateral (
    select sm.id from user_path_session us
    join moment sm on sm.id = us.moment_id
    join content_item ci on ci.id = sm.content_item_id
    join source so on so.id = ci.source_id
    where us.user_id = ${userId} and us.section_id = ps.section_id
      and us.ordinal = ps.ordinal and ${ALLOWED}
  ) swapped on true
  where ps.section_id = ${section}
`;

// A section's place in the user's order: theirs once they've edited the path (every
// section is copied then), else the approved one.
export const place = (userId: string, section: Ref) => sql<number>`coalesce(
  (select u.ordinal from user_path_section u
   where u.user_id = ${userId} and u.section_id = ${section}),
  (select placed.ordinal from path_section placed where placed.id = ${section})
)`;

// Skipped now: no checkpoint until it's unskipped.
export const skipped = (userId: string, section: Ref) => sql<boolean>`exists (
  select 1 from user_path_section u
  where u.user_id = ${userId} and u.section_id = ${section}
    and u.skipped_at is not null and u.unskipped_at is null
)`;

// Skipped at some point: it no longer holds the next sections back (owner, 2026-10-28).
export const everSkipped = (
  userId: string,
  section: Ref,
) => sql<boolean>`exists (
  select 1 from user_path_section u
  where u.user_id = ${userId} and u.section_id = ${section}
    and u.skipped_at is not null
)`;

// A section's checkpoint questions: live ones whose rights allow them (Q-1, ING-2),
// from its own readings (tier 0, in reading order), then on its live concepts (tier
// 1); a question in both is in its first tier.
export const checkpointQuestions = (userId: string, section: Ref) => sql`
  select distinct on (id) id, tier, ro, qo from (
    select q.id, 0 as tier, ps.ordinal as ro, q.ordinal as qo
    from (${sessions(userId, section)}) ps
    join moment m on m.id = ps.moment_id
    join content_item ci on ci.id = m.content_item_id
    join source so on so.id = ci.source_id
    join question q on q.moment_id = m.id and q.status = 'live'
      and q.kind = 'choice'
    where ${ALLOWED}
    union all
    select q.id, 1, 0, 0
    from path_section_concept pc
    join concept c on c.id = pc.concept_id and c.retired_at is null
    join question_concept qc on qc.concept_id = pc.concept_id
    join question q on q.id = qc.question_id and q.status = 'live'
      and q.kind = 'choice'
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

// Open when every section before it in the user's order is passed or was skipped.
export const sectionOpen = (
  userId: string,
  section: Ref,
) => sql<boolean>`not exists (
  select 1 from path_section cur
  join path_section prev on prev.path_id = cur.path_id and prev.id <> cur.id
  where cur.id = ${section}
    and ${place(userId, sql`prev.id`)} < ${place(userId, sql`cur.id`)}
    and not ${sectionPassed(userId, sql`prev.id`)}
    and not ${everSkipped(userId, sql`prev.id`)}
)`;

// Every reading the user can open is finished: its rights allow it and its link
// works (ING-6; a broken one can't be read, so it doesn't hold the checkpoint back).
export const readingsDone = (
  userId: string,
  section: Ref,
) => sql<boolean>`not exists (
  select 1 from (${sessions(userId, section)}) ps
  join moment m on m.id = ps.moment_id
  join content_item ci on ci.id = m.content_item_id
  join source so on so.id = ci.source_id
  where ${ALLOWED} and ci.link_broken_at is null
    and not exists (
      select 1 from user_moment_finished f
      where f.user_id = ${userId} and f.moment_id = ps.moment_id
    )
)`;

// P2-W11-S06 (Q-P2-35): a book chapter's checkpoint questions, its own live ones,
// made from its text for the book's owner alone.
export const chapterQuestions = (chapter: Ref) => sql`
  select q.id, 0 as tier, 0 as ro, q.ordinal as qo from question q
  where q.book_chapter_id = ${chapter} and q.status = 'live' and q.kind = 'choice'
`;
