// P6-W44 (LOAD-4, Q-P6-08): an HLD tournament round under load. Every player of the round
// hld-load-prepare made autosaves their design a few times and submits it, at once; the
// submission is simulated by the web app (CANVAS-5). Phase 6's "done when": 95% of
// simulations within 2 seconds, so the threshold is on the submit's whole round trip.
// Run with the local stack and the web app up (docs/runbooks/load-test.md):
//   scripts/with-env.sh k6 run -e ROUND=/tmp/hld-round.json scripts/load/hld-round.js
import http from "k6/http";
import { Counter, Trend } from "k6/metrics";
import exec from "k6/execution";

const round = JSON.parse(open(__ENV.ROUND));
const web = __ENV.WEB_URL || "http://localhost:3100";

const submitted = new Trend("submit_ms", true);
const saved = new Trend("autosave_ms", true);
const failed = new Counter("submits_failed");
const unsaved = new Counter("autosaves_failed");

export const options = {
  scenarios: {
    round: {
      executor: "per-vu-iterations",
      vus: round.seats.length,
      iterations: 1,
      maxDuration: "5m",
    },
  },
  thresholds: {
    submit_ms: ["p(95)<2000"],
    submits_failed: ["count==0"],
    autosaves_failed: ["count==0"],
  },
};

export default function () {
  const seat = round.seats[exec.vu.idInTest - 1];
  const params = {
    headers: {
      "content-type": "application/json",
      cookie: seat.cookie,
      origin: web,
    },
  };
  // A few autosaves first, as a player drawing would make.
  for (let base = 0; base < 3; base++) {
    const res = http.put(
      `${web}/api/hld/match/${seat.matchId}/design`,
      JSON.stringify({ design: round.design, base }),
      params,
    );
    saved.add(res.timings.duration);
    if (res.status !== 200) unsaved.add(1);
  }
  const res = http.post(
    `${web}/api/hld/match/${seat.matchId}/submit`,
    JSON.stringify({ design: round.design }),
    params,
  );
  submitted.add(res.timings.duration);
  if (res.status !== 200) failed.add(1);
}
