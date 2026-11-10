import { events, listening } from "./container";
import type { EventContext } from "./events";

// P4-W23-S01 (§5G, DB-5): playing a queued explainer, shared by the PWA and the app.
// explainer_started counts a listen once (a resume isn't a new one); finished counts
// one played to its end. Both feed W24-S02's listen share and completion.
export async function startListen(
  context: EventContext,
  explainerId: string,
): Promise<boolean> {
  const started = await listening().start(context.userId, explainerId);
  if (started === null) return false;
  if (started.new) {
    events().emit(
      "explainer_started",
      { explainer_id: explainerId, concept_id: started.conceptId },
      context,
    );
  }
  return true;
}

export async function finishListen(
  context: EventContext,
  explainerId: string,
): Promise<boolean> {
  const finished = await listening().finish(context.userId, explainerId);
  if (finished === null) return false;
  if (!finished.new) return true;
  events().emit(
    "explainer_finished",
    { explainer_id: explainerId, concept_id: finished.conceptId },
    context,
  );
  return true;
}
