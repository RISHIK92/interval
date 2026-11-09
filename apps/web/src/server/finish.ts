import { events, progress } from "./container";
import type { EventContext } from "./events";
import type { FinishMethod } from "./ports";

// Finishing a section or an article (§5D, C-22, Q-P1-35, P1-W5-S02): the return prompt,
// the web reader's Mark done, and the app's (P4-W20-S02).
export async function finishReading(
  context: EventContext,
  itemId: string,
  momentId: string | undefined,
  method: FinishMethod,
): Promise<void> {
  let finishedNow: boolean;
  if (momentId === undefined) {
    finishedNow = await progress().finishArticle(
      context.userId,
      itemId,
      method,
    );
    if (finishedNow)
      events().emit("article_finished", { method, item_id: itemId }, context);
  } else {
    finishedNow = await progress().finishMoment(
      context.userId,
      itemId,
      momentId,
      method,
    );
    if (finishedNow) {
      events().emit(
        "section_finished",
        { method, item_id: itemId, moment_id: momentId },
        context,
      );
      // Q-P1-35: the finish that completes an article finishes it (P1-W5-S03).
      if (
        await progress().finishArticleIfComplete(context.userId, itemId, method)
      ) {
        events().emit("article_finished", { method, item_id: itemId }, context);
      }
    }
  }
  // Exploration learns what was finished (REC-4); once per user and article. Its own
  // statement after the finish: if it fails, that finish is never counted (low is safe).
  if (finishedNow) await progress().countExploreFinish(context.userId, itemId);
}
