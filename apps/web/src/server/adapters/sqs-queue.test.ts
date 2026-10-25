import type { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { expect, test } from "vitest";
import { sqsQueue } from "./sqs-queue";

const PREFIX =
  "https://sqs.ap-south-1.amazonaws.com/123456789012/interval-prod-aws-";

test("enqueue sends JSON to the message's queue with the idempotency key", async () => {
  const sent: SendMessageCommand["input"][] = [];
  const client = {
    send: (command: SendMessageCommand) => {
      sent.push(command.input);
      return Promise.resolve({ MessageId: "m1" });
    },
  } as unknown as SQSClient;
  await sqsQueue(client, PREFIX).enqueue(
    "discover_source",
    { source_id: 4 },
    { idempotencyKey: "k1", delaySeconds: 30 },
  );
  expect(sent).toEqual([
    {
      QueueUrl: `${PREFIX}discover_source`,
      MessageBody: JSON.stringify({ source_id: 4 }),
      DelaySeconds: 30,
      MessageAttributes: {
        idempotency_key: { DataType: "String", StringValue: "k1" },
      },
    },
  ]);
});
