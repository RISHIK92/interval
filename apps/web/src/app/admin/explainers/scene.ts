import { checkAnchors, Timeline } from "@interval/diagrams";
import type { FileStore } from "../../../server/ports";

// P4.5-W26-S02 (AI-1, Q-P4.5-03; owner, 2026-11-11/12): a drafted timeline, read from the
// media bucket and held to every rule, including those the worker's JSON Schema can't
// say. The page shows what this returns and the approval runs it again, so what the
// owner approves is what was checked.
export async function loadTimeline(
  media: Pick<FileStore, "get">,
  key: string,
  words: number,
): Promise<{ timeline: Timeline } | { problems: string[] }> {
  const stored = await media.get(key);
  if (stored === null || stored === "unchanged")
    return { problems: ["The timeline's file isn't in the media bucket."] };
  let raw: unknown;
  try {
    raw = JSON.parse(await new Response(stored.body).text());
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return { problems: [`Not JSON: ${error.message}`] };
  }
  const parsed = Timeline.safeParse(raw);
  if (!parsed.success)
    return {
      problems: parsed.error.issues.map(
        (i) => `${i.path.join(".") || "timeline"}: ${i.message}`,
      ),
    };
  if (!checkAnchors(parsed.data, words))
    return {
      problems: ["A step is anchored past the explainer's last caption word."],
    };
  return { timeline: parsed.data };
}
