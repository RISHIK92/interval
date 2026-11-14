// P5-W34-S02 (LOAD-4, Q-P5-21): a ranked window's start under load. Every player of the
// battles load-prepare made connects to game server 0 at once and Submits the problem's
// Python reference; the time from sending the code to its verdict is measured. The goal:
// 95% of verdicts within 10 seconds. Run with the local stack, the game server and
// Velox up (docs/runbooks/load-test.md):
//   scripts/with-env.sh k6 run -e BATTLES=/tmp/battles.json scripts/load/window-start.js
// Tickets are minted here with GAME_TICKET_SECRET (apps/web/src/server/tickets.ts's
// format), as the web app would for each player.
import crypto from "k6/crypto";
import encoding from "k6/encoding";
import { Counter, Trend } from "k6/metrics";
import ws from "k6/ws";
import exec from "k6/execution";

const battles = JSON.parse(open(__ENV.BATTLES));
const seats = battles.battles.flatMap((b) =>
  b.players.map((player) => ({ matchId: b.matchId, player })),
);
const code = open(`../../problems/lld/${battles.slug}/references/solution.py`);
const server = __ENV.GAME_URL || "ws://localhost:8080";
const secret = __ENV.GAME_TICKET_SECRET;

const verdict = new Trend("verdict_ms", true);
const failed = new Counter("verdicts_failed");

export const options = {
  scenarios: {
    window_start: {
      executor: "per-vu-iterations",
      vus: seats.length,
      iterations: 1,
      maxDuration: "5m",
    },
  },
  thresholds: {
    verdict_ms: ["p(95)<10000"],
    verdicts_failed: ["count==0"],
  },
};

function ticket(matchId, player) {
  const claims = JSON.stringify({
    m: matchId,
    u: player,
    s: "0",
    e: Math.floor(Date.now() / 1000) + 60,
    n: `${exec.vu.idInTest}-${Date.now()}`,
  });
  const body = `v1.${encoding.b64encode(claims, "rawurl")}`;
  return `${body}.${crypto.hmac("sha256", secret, body, "base64rawurl")}`;
}

export default function () {
  if (!secret) throw new Error("GAME_TICKET_SECRET is not set");
  const seat = seats[exec.vu.idInTest - 1];
  const url = `${server}/game/0/ws?ticket=${encodeURIComponent(ticket(seat.matchId, seat.player))}`;
  let sent = 0;
  ws.connect(url, {}, (socket) => {
    socket.on("message", (raw) => {
      const message = JSON.parse(raw);
      if (message.type === "battle" && sent === 0) {
        sent = Date.now();
        socket.send(
          JSON.stringify({ type: "submit", language: "python", code }),
        );
      } else if (message.type === "submitted") {
        verdict.add(Date.now() - sent);
        socket.close();
      } else if (message.type === "judge_error" || message.type === "refused") {
        failed.add(1);
        socket.close();
      }
    });
    socket.setTimeout(() => {
      failed.add(1);
      socket.close();
    }, 120000);
  });
}
