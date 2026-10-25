import { z } from "zod";
import type { AdminReview, JobQueue, ReviewTags } from "./ports";

// ING-6, Q-P1-29, P1-W3-S05: an admin's corrections, checked against the item before
// they are kept. Boundaries must be the item's own headings; tags use the loaded
// concept graph and the three levels (Q-P1-10), five concepts at most (as tagging).

// Codes, not messages: the page shows fixed text for each, so a crafted link can't put
// words of its own in an admin's alert. `detail` is the offending input, shown as data.
export type SaveError =
  | "no-item"
  | "unknown-heading"
  | "not-a-moment"
  | "bad-tags"
  | "unknown-concept";
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

export async function saveBoundaries(
  review: AdminReview,
  queue: JobQueue,
  by: string,
  itemId: string,
  headings: string[],
): Promise<SaveResult> {
  const item = await review.item(itemId);
  if (item === null) return refused("no-item");
  const known = new Set(
    item.sections.flatMap((s) => (s.heading ? [s.heading] : [])),
  );
  const unknown = headings.filter((h) => !known.has(h));
  if (unknown.length > 0) return refused("unknown-heading", unknown);
  await review.setBoundaries(itemId, headings.length > 0 ? headings : null, by);
  // Segmentation reads the override; the worker re-tags and re-embeds after it.
  await queue.enqueue(
    "segment_item",
    { content_item_id: Number(itemId) },
    { idempotencyKey: `review-segment-${itemId}-${String(Date.now())}` },
  );
  return { ok: true };
}

export async function saveTags(
  review: AdminReview,
  by: string,
  itemId: string,
  heading: string,
  input: { difficulty: string; concepts: string[] } | null,
): Promise<SaveResult> {
  const item = await review.item(itemId);
  if (item === null) return refused("no-item");
  // Clearing works for any stored heading, so an override left behind by a boundary
  // change can still be removed; setting needs a heading that starts a moment now.
  if (input === null) {
    await review.setTags(itemId, heading, null, by);
    return { ok: true };
  }
  const headings = new Set(
    item.moments.flatMap((m) => (m.heading ? [m.heading] : [])),
  );
  if (heading !== "" && !headings.has(heading)) return refused("not-a-moment");
  const parsed = tagsSchema.safeParse({
    difficulty: input.difficulty,
    concepts: [...new Set(input.concepts)],
  });
  if (!parsed.success) return refused("bad-tags");
  const active = new Set(await review.activeConcepts());
  const unknown = parsed.data.concepts.filter((c) => !active.has(c));
  if (unknown.length > 0) return refused("unknown-concept", unknown);
  const tags: ReviewTags = parsed.data;
  await review.setTags(itemId, heading, tags, by);
  return { ok: true };
}
