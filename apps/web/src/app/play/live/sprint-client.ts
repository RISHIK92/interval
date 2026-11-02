import { z } from "zod";
import {
  parseMessage,
  START,
  sprintStep,
  type SprintState,
} from "./sprint-state";

// P3-W16-S04 (Q-P3-23): the live sprint's queue and socket, apart from React so it can
// be tested with fakes. Queue (join, poll about once a second, leave when stopped
// unmatched), then the match on the game server's socket, reconnecting while the
// server would still take the player back.

export type SprintSocket = {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
};
// Called with each frame's data and the close's reason.
export type SprintHandlers = {
  message: (data: unknown) => void;
  close: (reason: string) => void;
};

export type SprintDeps = {
  queue: (method: "POST" | "PUT" | "DELETE") => Promise<Response>;
  open: (matchId: string, on: SprintHandlers) => Promise<SprintSocket>;
  wait: (ms: number) => Promise<void>;
  now: () => number;
  onState: (state: SprintState) => void;
  onError: () => void; // the match can't go on
};

// /api/game/queue's poll.
const Polled = z.discriminatedUnion("status", [
  z.object({ status: z.literal("matched"), matchId: z.string() }),
  z.object({ status: z.literal("waiting") }),
  z.object({ status: z.literal("none") }),
]);

const POLL_MS = 1_000;
const RECONNECT_MS = 1_000;
// A restart gives players 60 s to come back (owner, 2026-11-02); a dropped socket's 10 s
// grace (MATCH-6) is within it.
const RECONNECT_WINDOW_MS = 60_000;
// Closes no reconnect can undo.
const FINAL_CLOSES = new Set(["match over", "joined again elsewhere"]);
const OPEN = 1; // WebSocket.OPEN

export function runSprint(deps: SprintDeps): {
  answer: (n: number, choice: number) => boolean;
  stop: () => void;
} {
  let stopped = false;
  let matched = false;
  let state: SprintState = START;
  let socket: SprintSocket | null = null;

  const fail = (error: unknown) => {
    console.error("live sprint failed", error);
    if (!stopped) deps.onError();
  };
  const over = () => state.phase === "final" || state.phase === "cancelled";

  const connect = async (matchId: string, droppedAt: number | null) => {
    let heard = false;
    let ws: SprintSocket | null = null;
    const on: SprintHandlers = {
      message: (data) => {
        let raw: unknown;
        try {
          raw = JSON.parse(String(data));
        } catch (error) {
          console.error("live sprint: not JSON", data, error);
          return;
        }
        const message = parseMessage(raw);
        if (message === null) {
          console.error("live sprint: not a sprint message", raw);
          return;
        }
        heard = true;
        state = sprintStep(state, message, deps.now());
        if (!stopped) deps.onState(state);
      },
      close: (reason) => {
        if (socket === ws) socket = null;
        if (stopped || over()) return;
        if (FINAL_CLOSES.has(reason)) {
          fail(new Error(`closed: ${reason}`));
          return;
        }
        // Back on a socket that worked: a later drop gets its own window.
        const since = heard || droppedAt === null ? deps.now() : droppedAt;
        retry(matchId, since, new Error(`closed: ${reason}`)).catch(fail);
      },
    };
    try {
      ws = await deps.open(matchId, on);
    } catch (error) {
      // A ticket or network failure mid-match: tried again like a dropped socket.
      await retry(matchId, droppedAt ?? deps.now(), error);
      return;
    }
    if (stopped) {
      ws.close();
      return;
    }
    socket = ws;
  };

  const retry = async (matchId: string, droppedAt: number, cause: unknown) => {
    if (deps.now() - droppedAt >= RECONNECT_WINDOW_MS) {
      fail(cause);
      return;
    }
    await deps.wait(RECONNECT_MS);
    if (!stopped) await connect(matchId, droppedAt);
  };

  const run = async () => {
    const joined = await deps.queue("POST");
    if (!joined.ok) throw new Error(`queue: ${String(joined.status)}`);
    while (!stopped) {
      const polled = await deps.queue("PUT");
      if (!polled.ok) throw new Error(`queue: ${String(polled.status)}`);
      const body = Polled.parse(await polled.json());
      if (body.status === "matched") {
        matched = true;
        deps.onState(state);
        await connect(body.matchId, null);
        return;
      }
      if (body.status === "none") {
        // Out of the queue (a throttled tab went stale, or a leave raced this join):
        // join again rather than poll a queue the player isn't in.
        const again = await deps.queue("POST");
        if (!again.ok) throw new Error(`queue: ${String(again.status)}`);
      }
      await deps.wait(POLL_MS);
    }
  };
  run().catch(fail);

  return {
    // False when there's no open socket (mid-reconnect): the server sends the
    // question again on resume.
    answer: (n, choice) => {
      if (socket === null || socket.readyState !== OPEN) return false;
      socket.send(JSON.stringify({ type: "answer", n, choice }));
      return true;
    },
    stop: () => {
      stopped = true;
      if (!matched)
        deps
          .queue("DELETE")
          .then((left) => {
            if (!left.ok) fail(new Error(`leave: ${String(left.status)}`));
          })
          .catch(fail);
      socket?.close();
      socket = null;
    },
  };
}
