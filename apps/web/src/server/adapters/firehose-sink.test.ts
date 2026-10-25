import type {
  FirehoseClient,
  PutRecordBatchCommand,
} from "@aws-sdk/client-firehose";
import type { Envelope } from "@interval/events";
import { expect, test } from "vitest";
import { firehoseSink } from "./firehose-sink";

function event(n: number): Envelope {
  return {
    event_id: `6f1c1f3e-0b7a-4c55-9d43-${String(n).padStart(12, "0")}`,
    name: "signup_completed",
    version: 1,
    occurred_at: "2026-10-25T10:00:00.000Z",
    user_id: "u1",
    is_guest: false,
    beta_group: "student",
    session_id: null,
    source: "web",
    props: {},
  };
}

// A stand-in for the SDK client: records each PutRecordBatch and answers per record.
function client(answer: (records: number) => { ErrorCode?: string }[]) {
  const calls: { stream: string | undefined; records: string[] }[] = [];
  const fake = {
    send: (command: PutRecordBatchCommand) => {
      const records = (command.input.Records ?? []).map((r) =>
        new TextDecoder().decode(r.Data),
      );
      calls.push({ stream: command.input.DeliveryStreamName, records });
      const results = answer(records.length);
      return Promise.resolve({
        FailedPutCount: results.filter((r) => r.ErrorCode !== undefined).length,
        RequestResponses: results,
      });
    },
  };
  return { client: fake as unknown as FirehoseClient, calls };
}

test("records are newline-terminated JSON, in batches of at most 500, to the stream", async () => {
  const { client: fake, calls } = client((n) =>
    Array.from({ length: n }, () => ({})),
  );
  const events = Array.from({ length: 501 }, (_, i) => event(i));
  expect(await firehoseSink(fake, "interval-events").write(events)).toEqual({
    failed: [],
  });
  expect(calls.map((c) => c.records.length)).toEqual([500, 1]);
  expect(calls[0]?.stream).toBe("interval-events");
  expect(calls[0]?.records[0]).toBe(`${JSON.stringify(events[0])}\n`);
});

test("records Firehose rejects come back as failed, in order", async () => {
  const { client: fake } = client((n) =>
    Array.from({ length: n }, (_, i) =>
      i === 1 ? { ErrorCode: "ServiceUnavailableException" } : {},
    ),
  );
  const events = [event(0), event(1), event(2)];
  expect(await firehoseSink(fake, "s").write(events)).toEqual({
    failed: [events[1]],
  });
});

test("failures without per-record responses count the whole chunk as undelivered", async () => {
  const fake = {
    send: () => Promise.resolve({ FailedPutCount: 1 }),
  } as unknown as FirehoseClient;
  const events = [event(0), event(1)];
  expect(await firehoseSink(fake, "s").write(events)).toEqual({
    failed: events,
  });
});
