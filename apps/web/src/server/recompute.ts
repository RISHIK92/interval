import type { JobQueue } from "./ports";
import { log } from "./log";

// Q-P1-17: a user's feed is recomputed after onboarding, feedback and profile changes.
// If the queue is down, the hourly pass catches up (LOAD-5): the failure is logged,
// never thrown at the user.
export async function queueRecompute(
  queue: JobQueue,
  userId: string,
  idempotencyKey: string,
  failure: string,
): Promise<void> {
  try {
    await queue.enqueue(
      "recompute_feed",
      { user_id: userId },
      { idempotencyKey },
    );
  } catch (error) {
    log.error(failure, { userId, error });
  }
}
