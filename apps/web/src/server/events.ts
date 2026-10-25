import {
  envelopeSchema,
  EVENT_VERSIONS,
  type Envelope,
  type EventName,
  type EventProps,
} from "@interval/events";
import { log } from "./log";
import type { BetaGroup, EventSink } from "./ports";

// Who and which visit an event belongs to (Q-P1-20 envelope).
export type EventContext = {
  userId: string;
  isGuest: boolean;
  betaGroup: BetaGroup;
  sessionId: string | null;
};

export type Emitter = {
  // Never throws and never waits: analytics must not break or slow a request.
  emit<N extends EventName>(
    name: N,
    props: EventProps[N],
    context: EventContext,
  ): void;
  // Writes what is buffered; resolves even when delivery fails.
  flush(): Promise<void>;
};

// Owner choices (2026-10-25): flush every second or at 100 events; retry rejected
// records once, then drop them. Every drop is logged as "events: emit failed" with a
// count, which the AWS stack turns into a metric.
export function createEmitter(
  sink: EventSink,
  opts: { flushMs?: number; maxBatch?: number } = {},
): Emitter {
  const flushMs = opts.flushMs ?? 1000;
  const maxBatch = opts.maxBatch ?? 100;
  let buffer: Envelope[] = [];
  let timer: NodeJS.Timeout | undefined;

  const dropped = (events: Envelope[], reason: string, error?: unknown) => {
    log.error("events: emit failed", {
      count: events.length,
      names: [...new Set(events.map((e) => e.name))],
      reason,
      error,
    });
  };

  const write = async (batch: Envelope[]): Promise<Envelope[]> => {
    try {
      return (await sink.write(batch)).failed;
    } catch (error) {
      log.warn("events: sink write failed", { count: batch.length, error });
      return batch;
    }
  };

  const flush = async (): Promise<void> => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    const batch = buffer;
    buffer = [];
    if (batch.length === 0) return;
    const failed = await write(batch);
    if (failed.length === 0) return;
    const stillFailed = await write(failed);
    if (stillFailed.length > 0) dropped(stillFailed, "undelivered");
  };

  return {
    emit(name, props, context) {
      const parsed = envelopeSchema.safeParse({
        event_id: crypto.randomUUID(),
        name,
        version: EVENT_VERSIONS[name],
        occurred_at: new Date().toISOString(),
        user_id: context.userId,
        is_guest: context.isGuest,
        beta_group: context.betaGroup,
        session_id: context.sessionId,
        source: "web",
        props,
      });
      if (!parsed.success) {
        log.error("events: emit failed", {
          count: 1,
          names: [name],
          reason: "invalid",
          issues: parsed.error.issues.map((i) => i.path.join(".")),
        });
        return;
      }
      buffer.push(parsed.data);
      if (buffer.length >= maxBatch) {
        void flush();
      } else {
        // unref: a pending flush must not keep a finishing process alive.
        timer ??= setTimeout(() => void flush(), flushMs).unref();
      }
    },
    flush,
  };
}
