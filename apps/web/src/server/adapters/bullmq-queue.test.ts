import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import { afterEach, expect, test } from "vitest";
import { bullmqQueue } from "./bullmq-queue";

// ADR-0014 against the local Valkey; a key prefix per test keeps runs apart.
const url = process.env["VALKEY_URL"];
if (url === undefined)
  throw new Error("VALKEY_URL is not set; see .env.example");
const opened: { close: () => Promise<void>; prefix: string }[] = [];

afterEach(async () => {
  for (const { close, prefix } of opened.splice(0)) {
    const queue = new Queue("discover_source", { connection: { url }, prefix });
    await queue.obliterate({ force: true });
    await queue.close();
    await close();
  }
});

function open() {
  const prefix = `test-${randomUUID()}`;
  const queue = bullmqQueue(url as string, { prefix, backoffMs: 20 });
  const reader = new Queue("discover_source", {
    connection: { url: url as string },
    prefix,
  });
  // Closed in afterEach, so a failed expectation can't leak a connection.
  opened.push({
    close: async () => {
      await reader.close();
      await queue.close();
    },
    prefix,
  });
  return { queue, reader };
}

test("a job carries the message, the idempotency key as jobId, 3 attempts and backoff", async () => {
  const { queue, reader } = open();
  await queue.enqueue(
    "discover_source",
    { source_id: 5 },
    { idempotencyKey: "k1", delaySeconds: 2 },
  );
  const job = await reader.getJob("k1");
  expect(job?.data).toEqual({ source_id: 5 });
  expect(job?.opts).toMatchObject({
    attempts: 3,
    backoff: { type: "exponential", delay: 20 },
    delay: 2000,
  });
});

test("the same key while pending makes one job", async () => {
  const { queue, reader } = open();
  await queue.enqueue(
    "discover_source",
    { source_id: 5 },
    { idempotencyKey: "same" },
  );
  await queue.enqueue(
    "discover_source",
    { source_id: 5 },
    { idempotencyKey: "same" },
  );
  expect(await reader.getJobCountByTypes("waiting")).toBe(1);
});
