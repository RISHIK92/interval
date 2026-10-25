import type { MessageName } from "@interval/db/messages";
import { Queue } from "bullmq";
import type { JobQueue } from "../ports";
import { ATTEMPTS, prepare } from "../queue";

// Retries back off exponentially from 30 s (the gap is engine-specific; SQS uses the
// visibility timeout).
const BACKOFF_MS = 30_000;

// BullMQ on Valkey (ADR-0014): local development and the VM.
export function bullmqQueue(
  url: string,
  options: { prefix?: string; backoffMs?: number } = {},
): JobQueue & { close(): Promise<void> } {
  const queues = new Map<MessageName, Queue>();
  const queueFor = (name: MessageName): Queue => {
    let queue = queues.get(name);
    if (queue === undefined) {
      queue = new Queue(name, {
        connection: { url },
        ...(options.prefix === undefined ? {} : { prefix: options.prefix }),
      });
      queues.set(name, queue);
    }
    return queue;
  };
  return {
    enqueue: async (name, message, { idempotencyKey, delaySeconds = 0 }) => {
      const payload = prepare(name, message, idempotencyKey, delaySeconds);
      const queue = queueFor(name);
      // A failed job keeps its id, which would silently swallow a re-enqueue (say,
      // after a fix); it has given up, so it makes way for the new one.
      const existing = await queue.getJob(idempotencyKey);
      if (existing !== undefined && (await existing.isFailed()))
        await existing.remove();
      await queue.add(name, payload, {
        // BullMQ ignores a jobId that already exists: dedupe while it's pending.
        jobId: idempotencyKey,
        attempts: ATTEMPTS,
        backoff: {
          type: "exponential",
          delay: options.backoffMs ?? BACKOFF_MS,
        },
        delay: delaySeconds * 1000,
        removeOnComplete: true,
        // The failed set is the dead-letter store, kept like the SQS DLQ: 14 days,
        // and bounded so a message that keeps failing can't grow it forever.
        removeOnFail: { age: 14 * 24 * 3600, count: 1000 },
      });
    },
    close: async () => {
      await Promise.all([...queues.values()].map((queue) => queue.close()));
    },
  };
}
