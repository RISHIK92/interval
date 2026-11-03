import { agentHook, events, jobQueue } from "../../../../server/container";
import { log } from "../../../../server/log";
import { hookRequest } from "../hook";

export const dynamic = "force-dynamic";

// §7: "If the agent is still running about 45 seconds later, a notification…"
const NUDGE_SECONDS = 45;

// P3-W17-S04 (§7): a coding agent started a task on this device. Called by the CLI
// (S05) with its device token: no cookie, no session. A repeat of the same key does
// nothing (LOAD-5).
export async function POST(request: Request): Promise<Response> {
  const now = new Date();
  const hook = await hookRequest(request, now);
  if (hook instanceof Response) return hook;
  const result = await agentHook().start(hook.deviceId, hook.key, now);
  if (result.status === "started") {
    events().emit("agent_task_started", {}, { ...hook.actor, sessionId: null });
    // P3-W17-S05b (§7, Q-P3-18): 45 s on, a push if the task still runs. A failed
    // enqueue loses only the nudge; the start stands (LOAD-5), logged and counted.
    try {
      await jobQueue().enqueue(
        "agent_nudge",
        { task_id: result.taskId },
        {
          idempotencyKey: `nudge-${String(result.taskId)}`,
          delaySeconds: NUDGE_SECONDS,
        },
      );
    } catch (error) {
      log.error("agent: nudge not queued", { taskId: result.taskId, error });
    }
  }
  return Response.json({ status: result.status });
}
