import {
  type MessageName,
  type Messages,
  messageSchemas,
} from "@interval/db/messages";

// ADR-0014: what both engines support. 3 deliveries, then the failed store (BullMQ's
// failed set, or the SQS DLQ's maxReceiveCount in infra/src/aws-stack.ts).
export const ATTEMPTS = 3;
// SQS's DelaySeconds limit; BullMQ allows more, but both engines must behave alike.
const MAX_DELAY_SECONDS = 900;

// BullMQ uses the key as the job id, which can't be empty, all digits or contain ":";
// SQS takes anything. Keys must work on both (the worker checks the same rule).
const KEY = /^(?!\d+$)[A-Za-z0-9_.@/-]{1,200}$/;

// The validated message, or an error before anything is sent (ADR-0010 schemas).
export function prepare<N extends MessageName>(
  name: N,
  message: Messages[N],
  idempotencyKey: string,
  delaySeconds: number,
): Messages[N] {
  if (!KEY.test(idempotencyKey)) {
    throw new Error(
      "idempotencyKey must be 1-200 of A-Z a-z 0-9 _ . @ / -, not only digits",
    );
  }
  if (
    !Number.isInteger(delaySeconds) ||
    delaySeconds < 0 ||
    delaySeconds > MAX_DELAY_SECONDS
  ) {
    throw new Error(`delaySeconds must be 0 to ${String(MAX_DELAY_SECONDS)}`);
  }
  return messageSchemas[name].parse(message);
}
