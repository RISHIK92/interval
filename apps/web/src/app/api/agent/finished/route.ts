import { agentHook, challenges, events } from "../../../../server/container";
import { log } from "../../../../server/log";
import { hookRequest } from "../hook";

export const dynamic = "force-dynamic";

// P3-W17-S04 (§7, Q-P3-28): the agent finished. The page the player had open is kept as
// their place (Home leads with it for 24 hours), and their open tab says so. A repeat of
// the same key does nothing (LOAD-5); with no running task there's nothing to finish.
export async function POST(request: Request): Promise<Response> {
  const now = new Date();
  const hook = await hookRequest(request, now);
  if (hook instanceof Response) return hook;
  const userId = hook.actor.userId;
  // Read before finishing: the place is saved with the finish, in one step, so a retry
  // (LOAD-5) can't find the task finished and its place lost.
  const page = await challenges().lastPage(userId);
  const result = await agentHook().finish(hook.deviceId, hook.key, now, page);
  if (result.status !== "finished")
    return Response.json({ status: result.status });
  if (page !== null) {
    try {
      await challenges().noteAgentFinished(userId);
    } catch (error) {
      // The place is saved; only the open tab's note is lost (LOAD-5).
      log.error("agent: finished note not set", { userId, error });
    }
  }
  events().emit(
    "agent_task_finished",
    { elapsed_ms: result.elapsedMs, place_saved: page !== null },
    { ...hook.actor, sessionId: null },
  );
  return Response.json({ status: "finished" });
}
