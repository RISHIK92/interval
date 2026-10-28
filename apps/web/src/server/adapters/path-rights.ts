import { type RawBuilder, sql } from "kysely";

// A path reading its rights allow now (ING-2), over `so` (source) and `ci` (content
// item): a source can be switched off or lowered after a path was approved, so every
// reader of paths re-checks (P2-W10-S02, S03).
export const ALLOWED = sql<boolean>`(so.moments_enabled
  and so.rights_profile in ('full_text_internal', 'full_text_display')
  and ci.duplicate_of is null)`;

// Moment `m` teaches the concept: an admin's correction replaces the model's tags (for a
// moment, by its heading), as kysely-progress credits reading (P2-W10-S05, S08).
export const momentTeaches = (
  concept: RawBuilder<unknown>,
) => sql<boolean>`exists (
  select 1 from concept taught
  where taught.id = ${concept} and taught.retired_at is null
    and taught.slug = any(coalesce(
      (select o.concepts from tag_override o
       where o.content_item_id = m.content_item_id
         and o.heading = m.title and m.link_type <> 'page_top'),
      array(select c2.slug from moment_concept mc
            join concept c2 on c2.id = mc.concept_id where mc.moment_id = m.id)
    ))
)`;
