import { events, paths } from "./container";
import type { EventContext } from "./events";

// §5F, Q-P2-27 (P2-W10-S03): Start (or Resume) makes a live path the user's active one,
// pausing any other; Pause stops it. The web's actions and the app's route
// (P4-W21-S03) both go through these, so each records its events once. False: not a
// live path of theirs.
export async function startPath(
  context: EventContext,
  pathId: string,
): Promise<boolean> {
  const started = await paths().start(context.userId, pathId);
  if (started === null) return false;
  // Q-P2-28: the pause a start causes counts as a pause for the continuity metric.
  if (started.paused !== null)
    events().emit(
      "path_paused",
      { path_id: started.paused, cause: "started_other" },
      context,
    );
  if (started.firstTime)
    events().emit("path_started", { path_id: pathId }, context);
  return true;
}

export async function pausePath(
  context: EventContext,
  pathId: string,
): Promise<boolean> {
  const paused = await paths().pause(context.userId, pathId);
  if (paused)
    events().emit("path_paused", { path_id: pathId, cause: "user" }, context);
  return paused;
}
