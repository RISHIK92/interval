import { z } from "zod";

// P3-W16-S04, S05 (Q-P3-23, Q-P3-24): a live game's queue and socket, apart from React
// so it can be tested with fakes. Queue (join, poll about once a second, leave when stopped
// unmatched), then the match on the game server's socket, reconnecting while the
// server would still take the player back.

export type LiveSocket = {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
};
// Called with each frame's data and the close's reason.
export type LiveHandlers = {
  message: (data: unknown) => void;
  close: (reason: string) => void;
};

// A mode's screen state from the game server's messages (sprint-state, finger-state).
export type LiveGame<S> = {
  start: S;
  // Null: not one of this game's messages.
  step: (state: S, raw: unknown, now: number) => S | null;
  over: (state: S) => boolean;
};

export type LiveDeps<S> = {
  game: LiveGame<S>;
  queue: (method: "POST" | "PUT" | "DELETE") => Promise<Response>;
  open: (matchId: string, on: LiveHandlers) => Promise<LiveSocket>;
  wait: (ms: number) => Promise<void>;
  now: () => number;
  onState: (state: S) => void;
  onError: () => void; // the match can't go on
  // P3-W17-S01, S02 (C-01): a ghost's or bot's match for this player, its id; null
  // when neither could be made.
  fallback: () => Promise<string | null>;
  onNoFallback: () => void;
  // BOT-3: the opponent's label when it isn't a person (a ghost or bot), from `joined`.
  onOpponent: (label: string) => void;
  // P3-W17-S03: a match already made (a friend challenge): no queue at all.
  matchId?: string;
};

// `joined`'s opponent label, which every mode's server sends alike.
const Joined = z.object({ type: z.literal("joined"), opponent: z.string() });

// /api/game/queue's poll.
const Polled = z.discriminatedUnion("status", [
  z.object({ status: z.literal("matched"), matchId: z.string() }),
  z.object({ status: z.literal("waiting") }),
  z.object({ status: z.literal("none") }),
]);

const POLL_MS = 1_000;
// C-01 (ADR-0006): no person after this long in the queue, a ghost or bot instead.
export const FALLBACK_MS = 10_000;
const RECONNECT_MS = 1_000;
// A restart gives players 60 s to come back (owner, 2026-11-02); a dropped socket's 10 s
// grace (MATCH-6) is within it.
const RECONNECT_WINDOW_MS = 60_000;
// Closes no reconnect can undo.
const FINAL_CLOSES = new Set(["match over", "joined again elsewhere"]);
const OPEN = 1; // WebSocket.OPEN

export function runLive<S>(deps: LiveDeps<S>): {
  answer: (n: number, choice: number) => boolean;
  focusLost: () => void;
  focusBack: () => void;
  pasted: (chars: number) => void;
  code: (submit: boolean, language: string, code: string) => boolean;
  fallback: () => void;
  stop: () => void;
} {
  let stopped = false;
  let matched = false;
  let state: S = deps.game.start;
  let socket: LiveSocket | null = null;

  const fail = (error: unknown) => {
    console.error("live game failed", error);
    if (!stopped) deps.onError();
  };
  const over = () => deps.game.over(state);

  const connect = async (matchId: string, droppedAt: number | null) => {
    let heard = false;
    let ws: LiveSocket | null = null;
    const on: LiveHandlers = {
      message: (data) => {
        let raw: unknown;
        try {
          raw = JSON.parse(String(data));
        } catch (error) {
          console.error("live game: not JSON", data, error);
          return;
        }
        const next = deps.game.step(state, raw, deps.now());
        if (next === null) {
          console.error("live game: not one of its messages", raw);
          return;
        }
        heard = true;
        state = next;
        const joined = Joined.safeParse(raw);
        if (joined.success) deps.onOpponent(joined.data.opponent);
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

  let rejoined = false;
  let fallbackWanted = false;
  let fellBack = false; // once only, by itself or asked for
  let fallbackPending = false;
  // Read through a call: `stop()` changes it while an await is pending, which the
  // type checker's narrowing can't see.
  const hasStopped = () => stopped;
  const run = async () => {
    if (deps.matchId !== undefined) {
      matched = true;
      deps.onState(state);
      await connect(deps.matchId, null);
      return;
    }
    const joined = await deps.queue("POST");
    if (!joined.ok) throw new Error(`queue: ${String(joined.status)}`);
    const since = deps.now();
    while (!stopped) {
      if (!fellBack && deps.now() - since >= FALLBACK_MS) fallbackWanted = true;
      if (fallbackWanted) {
        fallbackWanted = false;
        fellBack = true;
        // The route leaves the queues (and returns a person's match made meanwhile).
        fallbackPending = true;
        const matchId = await deps.fallback().finally(() => {
          fallbackPending = false;
        });
        // Left meanwhile: no queue to rejoin, and the route's match has nobody (it's
        // cancelled when nobody joins it).
        if (hasStopped()) return;
        if (matchId !== null) {
          matched = true;
          deps.onState(state);
          await connect(matchId, null);
          return;
        }
        deps.onNoFallback();
        const back = await deps.queue("POST");
        if (!back.ok) throw new Error(`queue: ${String(back.status)}`);
      }
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
        // join again, once. Out again means another tab took this player into another
        // mode's queue (one at a time, Q-P3-24); joining back would push that tab out
        // in turn, forever.
        if (rejoined) throw new Error("queue: joined elsewhere");
        rejoined = true;
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
    // P3-W18-S02 (§6.9): the page lost focus. The game server counts it only while a
    // question is live; one lost mid-reconnect goes unsaid.
    focusLost: () => {
      if (socket?.readyState === OPEN)
        socket.send(JSON.stringify({ type: "focus" }));
    },
    // P5-W31-S04a (§6.9, Q-P5-17): a battle's page is back in focus, or had a large
    // outside paste. The game server times the away and counts the paste.
    focusBack: () => {
      if (socket?.readyState === OPEN)
        socket.send(JSON.stringify({ type: "back" }));
    },
    pasted: (chars) => {
      if (socket?.readyState === OPEN)
        socket.send(JSON.stringify({ type: "paste", chars }));
    },
    // P5-W31-S03: a battle's Run or Submit. False with no open socket: nothing was sent,
    // and the page lets the player send again.
    code: (submit, language, code) => {
      if (socket === null || socket.readyState !== OPEN) return false;
      socket.send(
        JSON.stringify({ type: submit ? "submit" : "run", language, code }),
      );
      return true;
    },
    // "Play bot now": taken at the queue's next turn (within a poll).
    fallback: () => {
      // Pressed while one is under way: that one decides.
      if (!fallbackPending) fallbackWanted = true;
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
