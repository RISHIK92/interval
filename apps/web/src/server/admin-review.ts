import { z } from "zod";
import type { AdminReview, ReviewTags } from "./ports";

// ING-6, Q-P1-29, P1-W3-S05: an admin's corrections, checked against the item before
// they are kept. Tags use the loaded concept graph and the three levels (Q-P1-10), five
// concepts at most (as tagging). ADR-0058: the whole article only; boundary overrides
// went with moments.

// Codes, not messages: the page shows fixed text for each, so a crafted link can't put
// words of its own in an admin's alert. `detail` is the offending input, shown as data.
export type SaveError = "no-item" | "bad-tags" | "unknown-concept";
export type SaveResult =
  { ok: true } | { ok: false; error: SaveError; detail: string[] };

function refused(error: SaveError, detail: string[] = []): SaveResult {
  return { ok: false, error, detail };
}

const MAX_CONCEPTS = 5;
const tagsSchema = z.object({
  difficulty: z.enum(["beginner", "intermediate", "advanced"]),
  concepts: z.array(z.string()).max(MAX_CONCEPTS),
});

export async function saveTags(
  review: AdminReview,
  by: string,
  itemId: string,
  input: { difficulty: string; concepts: string[] } | null,
): Promise<SaveResult> {
  const item = await review.item(itemId);
  if (item === null) return refused("no-item");
  if (input === null) {
    await review.setTags(itemId, null, by);
    return { ok: true };
  }
  const parsed = tagsSchema.safeParse({
    difficulty: input.difficulty,
    concepts: [...new Set(input.concepts)],
  });
  if (!parsed.success) return refused("bad-tags");
  const active = new Set(await review.activeConcepts());
  const unknown = parsed.data.concepts.filter((c) => !active.has(c));
  if (unknown.length > 0) return refused("unknown-concept", unknown);
  const tags: ReviewTags = parsed.data;
  await review.setTags(itemId, tags, by);
  return { ok: true };
}
