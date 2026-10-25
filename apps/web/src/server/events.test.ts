import { envelopeSchema, type Envelope } from "@interval/events";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createEmitter, type EventContext } from "./events";
import type { EventSink } from "./ports";

// Emission logic on a fake sink (ADR-0012); the Firehose and file sinks have their own
// adapter tests.

const context: EventContext = {
  userId: "u1",
  isGuest: false,
  betaGroup: "developer",
  sessionId: "visit-1",
};

let logged: Record<string, unknown>[];

beforeEach(() => {
  vi.useFakeTimers();
  logged = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    logged.push(JSON.parse(String(chunk)) as Record<string, unknown>);
    return true;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function recordingSink(
  fail: (batch: Envelope[], call: number) => Envelope[] = () => [],
) {
  const batches: Envelope[][] = [];
  const sink: EventSink = {
    write: (batch) => {
      batches.push(batch);
      return Promise.resolve({ failed: fail(batch, batches.length) });
    },
  };
  return { sink, batches };
}

const failures = () => logged.filter((l) => l["msg"] === "events: emit failed");

describe("emit", () => {
  test("every event carries a valid envelope", async () => {
    const { sink, batches } = recordingSink();
    const events = createEmitter(sink);
    events.emit("feed_viewed", { card_count: 4 }, context);
    events.emit(
      "session_started",
      {},
      { ...context, isGuest: true, sessionId: null },
    );
    await events.flush();
    const written = batches.flat();
    expect(written).toHaveLength(2);
    for (const event of written)
      expect(envelopeSchema.parse(event)).toEqual(event);
    expect(written[0]).toMatchObject({
      name: "feed_viewed",
      version: 1,
      user_id: "u1",
      is_guest: false,
      beta_group: "developer",
      session_id: "visit-1",
      source: "web",
      props: { card_count: 4 },
    });
  });

  test("event_id is unique per emission (LOAD-5 idempotency key)", async () => {
    const { sink, batches } = recordingSink();
    const events = createEmitter(sink, { maxBatch: 10_000 });
    for (let i = 0; i < 1000; i += 1)
      events.emit("signup_completed", {}, context);
    await events.flush();
    expect(new Set(batches.flat().map((e) => e.event_id)).size).toBe(1000);
  });

  test("nothing is written until a flush; the timer flushes after a second", async () => {
    const { sink, batches } = recordingSink();
    const events = createEmitter(sink);
    events.emit("signup_completed", {}, context);
    expect(batches).toEqual([]);
    await vi.advanceTimersByTimeAsync(999);
    expect(batches).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(batches.flat()).toHaveLength(1);
  });

  test("a full batch of 100 is written without waiting for the timer", async () => {
    const { sink, batches } = recordingSink();
    const events = createEmitter(sink);
    for (let i = 0; i < 100; i += 1)
      events.emit("signup_completed", {}, context);
    await vi.advanceTimersByTimeAsync(0);
    expect(batches.map((b) => b.length)).toEqual([100]);
  });

  test("records the sink rejects are retried once, then dropped, logged and counted", async () => {
    // First call fails everything, the retry fails one of the two.
    const { sink, batches } = recordingSink((batch, call) =>
      call === 1 ? batch : batch.slice(0, 1),
    );
    const events = createEmitter(sink);
    events.emit("signup_completed", {}, context);
    events.emit("feed_viewed", { card_count: 1 }, context);
    await events.flush();
    expect(batches.map((b) => b.length)).toEqual([2, 2]);
    expect(failures()).toEqual([
      expect.objectContaining({
        level: "error",
        count: 1,
        names: ["signup_completed"],
      }),
    ]);
  });

  test("a sink that throws is retried once, then the batch is logged and counted", async () => {
    let calls = 0;
    const events = createEmitter({
      write: () => {
        calls += 1;
        return Promise.reject(new Error("firehose down"));
      },
    });
    events.emit("signup_completed", {}, context);
    await expect(events.flush()).resolves.toBeUndefined();
    expect(calls).toBe(2);
    expect(failures()).toEqual([expect.objectContaining({ count: 1 })]);
  });

  test("invalid props are dropped, logged and counted, never thrown", async () => {
    const { sink, batches } = recordingSink();
    const events = createEmitter(sink);
    expect(() => {
      events.emit("feed_viewed", { card_count: -1 }, context);
    }).not.toThrow();
    await events.flush();
    expect(batches.flat()).toEqual([]);
    expect(failures()).toEqual([
      expect.objectContaining({
        count: 1,
        names: ["feed_viewed"],
        reason: "invalid",
      }),
    ]);
  });
});
