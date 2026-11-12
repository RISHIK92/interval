import { expect, test } from "vitest";
import { type JudgeQueue, judgeClient } from "./client";
import { JudgeJob } from "./job";

// P5-W30-S05: submitting goes to the job's priority list; waiting reads its reply, or
// its stored result; a job outside the contract never reaches a worker.
function memory() {
  const lists = new Map<string, string[]>();
  const keys = new Map<string, string>();
  const queue: JudgeQueue = {
    push: (list, value) => {
      lists.set(list, [...(lists.get(list) ?? []), value]);
      return Promise.resolve();
    },
    blpop: (list) => Promise.resolve(lists.get(list)?.shift() ?? null),
    get: (key) => Promise.resolve(keys.get(key) ?? null),
  };
  return { queue, lists, keys };
}

const job: JudgeJob = {
  id: "8b1a3c3e-0f2d-4c56-9a7b-1e2f3a4b5c6d",
  priority: "ranked",
  language: "python",
  files: [{ name: "main.py", content: "print(1)" }],
  limits: { seconds: 5, memoryMB: 128 },
  runs: [{ stdin: "" }],
  submittedAt: "2026-11-12T10:00:00Z",
};
const result = {
  id: job.id,
  status: "done",
  runs: [{ verdict: "ok", timeMs: 12 }],
};

test("a job goes to its priority's list, as JSON", async () => {
  const { queue, lists } = memory();
  await judgeClient(queue).submit(job);
  expect(
    lists.get("judge:queue:ranked")?.map((v) => JSON.parse(v) as unknown),
  ).toEqual([job]);
});

test("a job outside the contract is refused before it is queued", async () => {
  const { queue, lists } = memory();
  const client = judgeClient(queue);
  await expect(
    client.submit({ ...job, priority: "urgent" as "ranked" }),
  ).rejects.toThrow();
  await expect(client.submit({ ...job, id: "not-a-uuid" })).rejects.toThrow();
  await expect(client.submit({ ...job, runs: [] })).rejects.toThrow();
  expect(lists.size).toBe(0);
});

test("the result comes from the reply, then from where it is kept", async () => {
  const { queue, lists, keys } = memory();
  const client = judgeClient(queue);
  expect(await client.result(job.id, 10)).toBeNull();
  lists.set(`judge:reply:${job.id}`, [JSON.stringify(result)]);
  expect(await client.result(job.id, 10)).toEqual(result);
  keys.set(`judge:result:${job.id}`, JSON.stringify(result));
  expect(await client.result(job.id, 10)).toEqual(result);
});

test("output is never returned unless a run asks for it", () => {
  const parsed = JudgeJob.parse(job);
  expect(parsed.runs[0]?.returnOutput).toBeUndefined();
});
