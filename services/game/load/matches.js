// P3-W18-S01 (LOAD-2, LOAD-4, Q-P3-19): many concurrent fastest-finger matches against
// one local game server. Run through run.sh, which seeds the matches and cleans up.
import crypto from "k6/crypto";
import encoding from "k6/encoding";
import { Counter, Rate, Trend } from "k6/metrics";
import { WebSocket } from "k6/websockets";

const MATCHES = Number(__ENV.MATCHES);
const SECRET = __ENV.GAME_TICKET_SECRET;
const BASE = `ws://127.0.0.1:${__ENV.PORT || "8090"}/game/0/ws`;
const RUN = __ENV.RUN; // run.sh's id for this run
const ROUNDS = 7;

export const options = {
  scenarios: {
    matches: {
      executor: "per-vu-iterations",
      vus: 2 * MATCHES,
      iterations: 1,
      maxDuration: "3m",
    },
  },
  // k6 exits non-zero when a match didn't finish or a socket failed.
  thresholds: { match_completed: ["rate==1"], socket_errors: ["count==0"] },
  summaryTrendStats: ["min", "med", "p(95)", "p(99)", "max"],
};

const matchStart = new Trend("match_start", true); // open → countdown (both joined)
const answerLocked = new Trend("answer_locked", true); // own answer → own "locked"
const answerReveal = new Trend("answer_reveal", true); // a's right answer → reveal
const completed = new Rate("match_completed");
const socketErrors = new Counter("socket_errors");

const b64 = (s) => encoding.b64encode(s, "rawurl");

// The ticket services/game/ticket.go verifies: v1.<claims>.<HMAC-SHA256>.
function ticket(match, user) {
  const claims = b64(
    JSON.stringify({
      m: match,
      u: user,
      s: "0",
      e: Math.floor(Date.now() / 1000) + 60,
      n: `${user}-${String(Math.random()).slice(2)}`,
    }),
  );
  const head = `v1.${claims}`;
  return `${head}.${crypto.hmac("sha256", SECRET, head, "base64rawurl")}`;
}

const between = (lo, hi) => lo + Math.random() * (hi - lo);

export default function () {
  if (!SECRET || !RUN || !(MATCHES > 0))
    throw new Error("RUN, MATCHES and GAME_TICKET_SECRET are needed");
  const i = Math.floor((__VU - 1) / 2) + 1;
  const seat = __VU % 2 === 1 ? "a" : "b";
  const match = `load-${RUN}-${String(i)}`;
  const me = `${match}-${seat}`;
  const ws = new WebSocket(`${BASE}?ticket=${ticket(match, me)}`);
  let opened = 0;
  let sentAt = 0;
  let finished = false;

  ws.onopen = () => {
    opened = Date.now();
  };
  ws.onmessage = (event) => {
    const m = JSON.parse(event.data);
    if (m.type === "countdown") matchStart.add(Date.now() - opened);
    if (m.type === "round") {
      // a answers right, b wrong: every round runs to a's answer.
      const choice = seat === "a" ? 0 : 1 + Math.floor(Math.random() * 3);
      const wait = seat === "a" ? between(300, 1200) : between(200, 1000);
      setTimeout(() => {
        sentAt = Date.now();
        ws.send(JSON.stringify({ type: "answer", n: m.n, choice }));
      }, wait);
    }
    if (m.type === "locked" && m.player === me && sentAt > 0)
      answerLocked.add(Date.now() - sentAt);
    if (m.type === "reveal" && seat === "a" && sentAt > 0)
      answerReveal.add(Date.now() - sentAt);
    if (m.type === "reveal") sentAt = 0;
    if (m.type === "final") {
      finished = true;
      if (seat === "a")
        completed.add(m.winner === me && m.totals[me] === ROUNDS);
      // No close here: the server closes once it has saved the result, so cleanup
      // runs after its writes.
    }
  };
  ws.onerror = () => {
    socketErrors.add(1);
  };
  ws.onclose = () => {
    if (!finished) {
      socketErrors.add(1);
      if (seat === "a") completed.add(false);
    }
  };
}
