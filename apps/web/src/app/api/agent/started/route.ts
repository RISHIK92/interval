import { agentHook, events } from "../../../../server/container";
import { hookRequest } from "../hook";

export const dynamic = "force-dynamic";

// P3-W17-S04 (§7): a coding agent started a task on this device. Called by the CLI
// (S05) with its device token: no cookie, no session. A repeat of the same key does
// nothing (LOAD-5).
export async function POST(request: Request): Promise<Response> {
  const now = new Date();
  const hook = await hookRequest(request, now);
  if (hook instanceof Response) return hook;
  const result = await agentHook().start(hook.deviceId, hook.key, now);
  if (result === "started")
    events().emit("agent_task_started", {}, { ...hook.actor, sessionId: null });
  return Response.json({ status: result });
}
