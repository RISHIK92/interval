import { type RawBuilder, sql } from "kysely";

// A path reading its rights allow now (ING-2), over `so` (source) and `ci` (content
// item): a source can be lowered after a path was approved, so every reader of paths
// re-checks (P2-W10-S02, S03). ADR-0058: a reading is a whole article; the rule is
// user_path_articles' for a swapped one (ARCH-2), with the moments switch gone.
export const ALLOWED = sql<boolean>`(so.rights_profile in
  ('full_text_internal', 'full_text_display')
  and ci.duplicate_of is null)`;

// Article `ci` teaches the concept: an admin's whole-article correction replaces the
// model's tags, as kysely-progress credits reading (P2-W10-S05, S08; ADR-0058).
export const articleTeaches = (
  concept: RawBuilder<unknown>,
) => sql<boolean>`exists (
  select 1 from concept taught
  where taught.id = ${concept} and taught.retired_at is null
    and taught.slug = any(coalesce(
      (select o.concepts from tag_override o
       where o.content_item_id = ci.id),
      array(select c2.slug from item_concept ic
            join concept c2 on c2.id = ic.concept_id
            where ic.content_item_id = ci.id)
    ))
)`;
