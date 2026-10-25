import type { AdminSources, JobQueue } from "./ports";

// §3.2, ING-2, P1-W3-S06: an admin switches a source's moments off, and its moments
// leave the feed at once. (Whole-article cards, the fallback §3.2 describes, don't
// exist yet: until they do, the source's articles drop out of the feed.) Switching back
// on gives moments again only where the seed file allows them, by segmenting the
// source's stored full text again; the worker then re-tags and re-embeds those items,
// which costs model calls within the AI budgets (OPS-4).
//
// The switch is written first, because segmentation reads it. If queueing fails part
// way, switching off and on again re-queues every item.
export async function switchMoments(
  sources: AdminSources,
  queue: JobQueue,
  by: string,
  sourceId: string,
  off: boolean,
): Promise<{ ok: boolean }> {
  const source = await sources.get(sourceId);
  if (source === null) return { ok: false };
  // Already as asked (a double submit): nothing to write or queue.
  if (source.momentsSwitchedOff === off) return { ok: true };
  await sources.setMomentsSwitchedOff(sourceId, off, by);
  if (!off && source.momentsSeeded) {
    const stamp = String(Date.now());
    for (const itemId of await sources.fullTextItemIds(sourceId)) {
      await queue.enqueue(
        "segment_item",
        { content_item_id: Number(itemId) },
        { idempotencyKey: `switch-segment-${itemId}-${stamp}` },
      );
    }
  }
  return { ok: true };
}
