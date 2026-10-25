import {
  type FirehoseClient,
  PutRecordBatchCommand,
} from "@aws-sdk/client-firehose";
import type { Envelope } from "@interval/events";
import type { EventSink } from "../ports";

// PutRecordBatch takes at most 500 records per call.
const MAX_RECORDS = 500;

// DB-5: events into Firehose, which writes them to S3 for Athena. Each record ends in a
// newline, so the S3 objects are JSON lines.
export function firehoseSink(
  client: FirehoseClient,
  stream: string,
): EventSink {
  const encoder = new TextEncoder();
  return {
    write: async (batch) => {
      const failed: Envelope[] = [];
      for (let start = 0; start < batch.length; start += MAX_RECORDS) {
        const chunk = batch.slice(start, start + MAX_RECORDS);
        const result = await client.send(
          new PutRecordBatchCommand({
            DeliveryStreamName: stream,
            Records: chunk.map((e) => ({
              Data: encoder.encode(`${JSON.stringify(e)}\n`),
            })),
          }),
        );
        if ((result.FailedPutCount ?? 0) === 0) continue;
        const responses = result.RequestResponses ?? [];
        // Without one response per record we can't tell which failed: retry them all.
        if (responses.length !== chunk.length) {
          failed.push(...chunk);
          continue;
        }
        // Responses are in request order; a record with an ErrorCode was not stored.
        responses.forEach((response, i) => {
          const event = chunk[i];
          if (response.ErrorCode !== undefined && event !== undefined)
            failed.push(event);
        });
      }
      return { failed };
    },
  };
}
