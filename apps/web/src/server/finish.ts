import { events, progress } from "./container";
import type { EventContext } from "./events";
import type { FinishMethod } from "./ports";

// Completing an article (§5D, C-22, Q-P1-35, P1-W5-S02; ADR-0058): the return prompt,
// the web reader's Done, and the app's (P4-W20-S02).
export async function finishReading(
  context: EventContext,
  itemId: string,
  method: FinishMethod,
): Promise<void> {
  const finishedNow = await progress().finishArticle(
    context.userId,
    itemId,
    method,
  );
  if (!finishedNow) return;
  events().emit("article_completed", { method, item_id: itemId }, context);
  // Exploration learns what was finished (REC-4); once per user and article. Its own
  // statement after the finish: if it fails, that finish is never counted (low is safe).
  await progress().countExploreFinish(context.userId, itemId);
}
