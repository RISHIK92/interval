import { afterEach, expect, test, vi } from "vitest";
import {
  runLive,
  type LiveDeps,
  type LiveHandlers,
  type LiveSocket,
} from "./live-client";
import { SPRINT, type SprintState } from "./sprint-state";

// P3-W16-S04 (Q-P3-23): a live game's queue and socket, with fakes (here, a sprint).

class FakeSocket implements LiveSocket {
  readyState = 1;
  sent: string[] = [];
  closed = false;
  constructor(private readonly on: LiveHandlers) {}
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
  message(body: unknown) {
    this.on.message(JSON.stringify(body));
  }
  raw(data: unknown) {
    this.on.message(data);
  }
  drop(reason = "") {
    this.on.close(reason);
  }
}

const json = (body: unknown) => new Response(JSON.stringify(body));
const flush = async () => {
  for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 0));
};

function harness(polls: unknown[]) {
  let now = 0;
  const calls: string[] = [];
  const sockets: FakeSocket[] = [];
  const states: SprintState[] = [];
  let openFails = 0;
  const deps: LiveDeps<SprintState> = {
    game: SPRINT,
    queue: (method) => {
      calls.push(method);
      if (method !== "PUT")
        return Promise.resolve(new Response(null, { status: 204 }));
      return Promise.resolve(json(polls.shift() ?? { status: "waiting" }));
    },
    open: (_, on) => {
      if (openFails > 0) {
        openFails -= 1;
        return Promise.reject(new Error("no ticket: 503"));
      }
      const s = new FakeSocket(on);
      sockets.push(s);
      return Promise.resolve(s);
    },
    // A real wait yields to timers; so does this one, so a polling loop can't starve them.
    wait: (ms) => {
      now += ms;
      return new Promise((r) => setTimeout(r, 0));
    },
    now: () => now,
    onState: (s) => states.push(s),
    onError: vi.fn(),
    fallback: vi.fn<() => Promise<string | null>>(() => Promise.resolve(null)),
    onNoFallback: vi.fn(),
    onOpponent: vi.fn(),
  };
  return {
    deps,
    calls,
    sockets,
    states,
    advance: (ms: number) => (now += ms),
    failOpens: (n: number) => (openFails = n),
  };
}

const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
afterEach(() => {
  errors.mockClear();
});

test("joins, polls, joins again when out of the queue, then plays the match", async () => {
  const h = harness([
    { status: "waiting" },
    { status: "none" },
    { status: "matched", matchId: "m1" },
  ]);
  const sprint = runLive(h.deps);
  await flush();
  expect(h.calls).toEqual(["POST", "PUT", "PUT", "POST", "PUT"]);
  const [socket] = h.sockets;
  if (socket === undefined) throw new Error("no socket");
  socket.message({ type: "joined", match: "m1", you: "ada" });
  socket.message({ type: "start", seconds: 60 });
  expect(h.states.at(-1)).toMatchObject({ phase: "playing", you: "ada" });
  expect(sprint.answer(1, 2)).toBe(true);
  expect(JSON.parse(socket.sent[0] ?? "")).toEqual({
    type: "answer",
    n: 1,
    choice: 2,
  });
  // Not open (connecting again): nothing sent, nothing thrown.
  socket.readyState = 0;
  expect(sprint.answer(2, 0)).toBe(false);
  sprint.stop();
  expect(socket.closed).toBe(true);
  expect(h.calls).not.toContain("DELETE"); // matched: too late to leave
});

test("stopped while queued, it leaves the queue", async () => {
  const h = harness([]);
  const sprint = runLive(h.deps);
  await flush();
  sprint.stop();
  await flush();
  expect(h.calls.at(-1)).toBe("DELETE");
  expect(h.deps.onError).not.toHaveBeenCalled();
});

test("a failed leave is logged", async () => {
  const h = harness([]);
  h.deps.queue = (method) =>
    Promise.resolve(
      method === "DELETE"
        ? new Response(null, { status: 500 })
        : json({ status: "waiting" }),
    );
  const sprint = runLive(h.deps);
  await flush();
  sprint.stop();
  await flush();
  expect(errors).toHaveBeenCalled();
});

test("a dropped socket reconnects, and a failed ticket is tried again", async () => {
  const h = harness([{ status: "matched", matchId: "m1" }]);
  runLive(h.deps);
  await flush();
  h.sockets[0]?.message({ type: "start", seconds: 60 });
  h.failOpens(1);
  h.sockets[0]?.drop();
  await flush();
  expect(h.sockets).toHaveLength(2);
  expect(h.deps.onError).not.toHaveBeenCalled();
});

test("each drop gets its own window once back; past 60 s it gives up", async () => {
  const h = harness([{ status: "matched", matchId: "m1" }]);
  runLive(h.deps);
  await flush();
  for (let i = 0; i < 5; i += 1) {
    h.sockets.at(-1)?.message({ type: "start", seconds: 60 });
    h.sockets.at(-1)?.drop();
    await flush();
  }
  expect(h.deps.onError).not.toHaveBeenCalled();
  // Never heard from again: the window runs out.
  h.advance(61_000);
  h.sockets.at(-1)?.drop();
  await flush();
  expect(h.deps.onError).toHaveBeenCalledOnce();
});

test("no reconnect after the final, nor after the server says the match is over", async () => {
  const h = harness([{ status: "matched", matchId: "m1" }]);
  runLive(h.deps);
  await flush();
  h.sockets[0]?.message({ type: "final", totals: {}, winner: "" });
  h.sockets[0]?.drop("match over");
  await flush();
  expect(h.sockets).toHaveLength(1);
  expect(h.deps.onError).not.toHaveBeenCalled();

  const h2 = harness([{ status: "matched", matchId: "m2" }]);
  runLive(h2.deps);
  await flush();
  h2.sockets[0]?.drop("joined again elsewhere");
  await flush();
  expect(h2.sockets).toHaveLength(1);
  expect(h2.deps.onError).toHaveBeenCalledOnce();
});

test("a frame that isn't a sprint message is logged, not shown", async () => {
  const h = harness([{ status: "matched", matchId: "m1" }]);
  runLive(h.deps);
  await flush();
  const before = h.states.length;
  h.sockets[0]?.raw("not json");
  h.sockets[0]?.message({ type: "reveal", n: 1 });
  expect(h.states).toHaveLength(before);
  expect(errors).toHaveBeenCalledTimes(2);
});

test("out of the queue twice (another tab's mode took it): it stops, not fights", async () => {
  const h = harness([{ status: "none" }, { status: "none" }]);
  runLive(h.deps);
  await flush();
  expect(h.calls).toEqual(["POST", "PUT", "POST", "PUT"]);
  expect(h.deps.onError).toHaveBeenCalledOnce();
});

// P3-W17-S01, S02 (C-01, Q-P3-26): "Play bot now", or 10 s in the queue, stops queueing
// and plays a ghost or bot; with none it says so and queues on. The label reaches the
// screen.
test("the fallback asked for is played instead of the queue", async () => {
  const h = harness([]);
  h.deps.fallback = vi.fn(() => Promise.resolve("g-match"));
  const live = runLive(h.deps);
  await flush();
  live.fallback();
  await flush();
  expect(h.deps.fallback).toHaveBeenCalledOnce();
  expect(h.sockets).toHaveLength(1);
  h.sockets[0]?.message({
    type: "joined",
    match: "g-match",
    you: "ada",
    opponent: "Bot · ~1600",
  });
  expect(h.deps.onOpponent).toHaveBeenCalledWith("Bot · ~1600");
  live.stop();
  await flush();
  expect(h.calls).not.toContain("DELETE"); // the route left the queue
});

test("nothing to play: said, and back in the queue", async () => {
  const h = harness([]);
  const live = runLive(h.deps);
  live.fallback(); // pressed at once, before the 10 s
  await flush();
  expect(h.deps.fallback).toHaveBeenCalledOnce();
  expect(h.deps.onNoFallback).toHaveBeenCalledOnce();
  // Joined again after the route left the queue for it.
  expect(h.calls.filter((c) => c === "POST")).toHaveLength(2);
  expect(h.sockets).toHaveLength(0);
  live.stop();
});

// C-01: after 10 s with no person, once, on the queue's own clock (each poll's wait
// moves the fake clock a second).
test("after 10 s in the queue it falls back by itself, once", async () => {
  const h = harness([]);
  let putsBefore = -1;
  h.deps.fallback = vi.fn(() => {
    putsBefore = h.calls.filter((c) => c === "PUT").length;
    return Promise.resolve(null);
  });
  const live = runLive(h.deps);
  for (let i = 0; i < 10; i += 1) await flush();
  expect(h.deps.fallback).toHaveBeenCalledOnce();
  expect(putsBefore).toBe(10); // ten polls a second apart: 10 s
  expect(h.deps.onNoFallback).toHaveBeenCalledOnce();
  // Nothing fitted: queued on, never tried again by itself.
  expect(h.calls.filter((c) => c === "PUT").length).toBeGreaterThan(15);
  live.stop();
});

test("a person matched before 10 s is played, not a fallback", async () => {
  const h = harness([{ status: "matched", matchId: "m1" }]);
  runLive(h.deps);
  await flush();
  h.advance(20_000);
  await flush();
  expect(h.deps.fallback).not.toHaveBeenCalled();
  expect(h.sockets).toHaveLength(1);
});

// Left while the fallback was under way: nothing rejoins the queue or plays the match.
test("stopped while the fallback is under way: no rejoin, no match", async () => {
  const h = harness([]);
  let settle: (id: string | null) => void = () => undefined;
  h.deps.fallback = vi.fn(
    () =>
      new Promise<string | null>((resolve) => {
        settle = resolve;
      }),
  );
  const live = runLive(h.deps);
  live.fallback();
  await flush();
  live.fallback(); // pressed again meanwhile: ignored
  live.stop();
  settle(null);
  await flush();
  expect(h.deps.fallback).toHaveBeenCalledOnce();
  expect(h.deps.onNoFallback).not.toHaveBeenCalled();
  // One join, the leave; no rejoin after it.
  expect(h.calls.filter((c) => c === "POST")).toHaveLength(1);
  expect(h.calls.at(-1)).toBe("DELETE");
  expect(h.sockets).toHaveLength(0);
});

// P3-W17-S03: a friend challenge's match is joined at once, with no queue.
test("a match already made is joined without the queue", async () => {
  const h = harness([]);
  h.deps.matchId = "friend-1";
  const live = runLive(h.deps);
  await flush();
  expect(h.calls).toEqual([]);
  expect(h.sockets).toHaveLength(1);
  h.advance(20_000);
  await flush();
  expect(h.deps.fallback).not.toHaveBeenCalled();
  live.stop();
  await flush();
  expect(h.calls).toEqual([]); // nothing to leave
});

// P3-W18-S02 (§6.9, Q-P3-20): the page losing focus is told to the game server, which
// decides whether a question was live; with no open socket, nothing is sent.
test("a focus change goes to the game server while its socket is open", async () => {
  const h = harness([{ status: "matched", matchId: "m1" }]);
  const live = runLive(h.deps);
  live.focusLost(); // still queued: no socket
  await flush();
  const [socket] = h.sockets;
  if (socket === undefined) throw new Error("no socket");
  live.focusLost();
  expect(socket.sent.map((s) => JSON.parse(s) as unknown)).toEqual([
    { type: "focus" },
  ]);
  socket.readyState = 0;
  live.focusLost();
  expect(socket.sent).toHaveLength(1);
  live.stop();
});
