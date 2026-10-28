import { sql } from "kysely";

// A path reading its rights allow now (ING-2), over `so` (source) and `ci` (content
// item): a source can be switched off or lowered after a path was approved, so every
// reader of paths re-checks (P2-W10-S02, S03).
export const ALLOWED = sql<boolean>`(so.moments_enabled
  and so.rights_profile in ('full_text_internal', 'full_text_display')
  and ci.duplicate_of is null)`;
