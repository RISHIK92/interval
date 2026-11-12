import { JudgeJob, JudgeResult } from "./job";

// P5-W30-S05 (LOAD-3, LOAD-5): how any TS service submits a job and waits for its
// result. Written against a minimal port (ADR-0012): an ioredis adapter where a service
// has Valkey, an in-memory fake in tests. Go services use services/exec/judge directly.
export interface JudgeQueue {
  // Append a value to a list.
  push(list: string, value: string): Promise<void>;
  // Wait up to timeoutSeconds for a list's first value; null when none came.
  blpop(list: string, timeoutSeconds: number): Promise<string | null>;
  get(key: string): Promise<string | null>;
}

export function judgeClient(queue: JudgeQueue, prefix = "judge") {
  return {
    // Validated here, before it reaches a worker: a bad job is the submitter's bug.
    async submit(job: JudgeJob): Promise<void> {
      const valid = JudgeJob.parse(job);
      await queue.push(
        `${prefix}:queue:${valid.priority}`,
        JSON.stringify(valid),
      );
    },
    // The result, or null if none came within the time. A result stored earlier (the
    // reply already taken, or a second wait) is read back from its own key.
    async result(id: string, timeoutMs: number): Promise<JudgeResult | null> {
      const reply = await queue.blpop(
        `${prefix}:reply:${id}`,
        Math.max(1, Math.ceil(timeoutMs / 1000)),
      );
      const raw = reply ?? (await queue.get(`${prefix}:result:${id}`));
      return raw === null ? null : JudgeResult.parse(JSON.parse(raw));
    },
  };
}
