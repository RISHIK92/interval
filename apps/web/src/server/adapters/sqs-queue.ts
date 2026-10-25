import { SendMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";
import type { JobQueue } from "../ports";
import { prepare } from "../queue";

// SQS (ADR-0014): the full-AWS mode. One queue per message name, <prefix><name>.
export function sqsQueue(client: SQSClient, urlPrefix: string): JobQueue {
  return {
    enqueue: async (name, message, { idempotencyKey, delaySeconds = 0 }) => {
      const payload = prepare(name, message, idempotencyKey, delaySeconds);
      await client.send(
        new SendMessageCommand({
          QueueUrl: `${urlPrefix}${name}`,
          MessageBody: JSON.stringify(payload),
          DelaySeconds: delaySeconds,
          // Standard queues don't dedupe; the worker checks this key (LOAD-5).
          MessageAttributes: {
            idempotency_key: {
              DataType: "String",
              StringValue: idempotencyKey,
            },
          },
        }),
      );
    },
  };
}
