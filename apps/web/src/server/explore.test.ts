import { expect, test, vi } from "vitest";
import {
  type AskBody,
  askRefusal,
  followedTopics,
  learnersLabel,
  sessionPlan,
  submitAsk,
} from "./explore";
import type { EventContext } from "./events";
import type { Asks, Entitlements, JobQueue } from "./ports";

// ADR-0046: Ask's gate and flow, and the spaces' rules, with in-memory fakes
// (ADR-0012).

const NOW = new Date("2026-11-26T15:00:00Z");
const CONTEXT: EventContext = {
  userId: "u1",
  isGuest: false,
  betaGroup: null,
  sessionId: null,
};
const BODY: AskBody = {
  text: "When should I shard?",
  chip: "explain_new",
  idempotencyKey: "key-1",
  followUpOf: null,
};

function fakes(
  opts: {
    asked?: number;
    daily?: number | null;
    capCents?: number | null;
    userUsd?: number;
    globalUsd?: number;
    globalCapCents?: number;
    enqueue?: JobQueue["enqueue"];
  } = {},
) {
  const questions = new Map<string, string>();
  const dropped: string[] = [];
  const since: Date[] = [];
  const asks: Asks = {
    submit: (_userId, ask) => {
      const existing = questions.get(ask.idempotencyKey);
      if (existing !== undefined)
        return Promise.resolve({ id: existing, created: false });
      const id = `q${String(questions.size + 1)}`;
      questions.set(ask.idempotencyKey, id);
      return Promise.resolve({ id, created: true });
    },
    sessionArticles: () => Promise.resolve(null),
    existing: (_userId, key) => Promise.resolve(questions.get(key) ?? null),
    drop: (id) => {
      dropped.push(id);
      return Promise.resolve();
    },
    get: () => Promise.resolve(null),
    latest: () => Promise.resolve(null),
    remove: () => Promise.resolve(false),
    askedSince: (_userId, day) => {
      since.push(day);
      return Promise.resolve(opts.asked ?? 0);
    },
    spentToday: () =>
      Promise.resolve({
        userUsd: opts.userUsd ?? 0,
        globalUsd: opts.globalUsd ?? 0,
        globalCapCents: opts.globalCapCents ?? 30,
      }),
  };
  const entitlements: Pick<Entitlements, "limit"> = {
    limit: (_userId, capability) =>
      Promise.resolve(
        capability === "explore.ask.daily"
          ? opts.daily === undefined
            ? 20
            : opts.daily
          : opts.capCents === undefined
            ? 50
            : opts.capCents,
      ),
  };
  const enqueue = vi.fn(opts.enqueue ?? (() => Promise.resolve()));
  const queue: JobQueue = { enqueue };
  const emit = vi.fn();
  return {
    deps: { asks, entitlements, queue, events: { emit } },
    enqueue,
    emit,
    dropped,
    since,
  };
}

test("an ask within the limits is stored, queued once and counted without its text", async () => {
  const f = fakes();
  expect(await submitAsk(f.deps, CONTEXT, BODY, NOW)).toEqual({
    status: "queued",
    id: "q1",
  });
  // LOAD-5: a retried submit is the same question, queued and counted once.
  expect(await submitAsk(f.deps, CONTEXT, BODY, NOW)).toEqual({
    status: "queued",
    id: "q1",
  });
  expect(f.enqueue).toHaveBeenCalledTimes(1);
  expect(f.enqueue).toHaveBeenCalledWith(
    "ask",
    { question_id: "q1" },
    { idempotencyKey: "ask-q1" },
  );
  expect(f.emit).toHaveBeenCalledTimes(1);
  expect(f.emit).toHaveBeenCalledWith(
    "ask_submitted",
    { length: BODY.text.length, chip: "explain_new", follow_up: false },
    CONTEXT,
  );
  expect(JSON.stringify(f.emit.mock.calls)).not.toContain("shard");
});

test("the daily count is today's, in UTC", async () => {
  const f = fakes({ asked: 19 });
  expect(await askRefusal(f.deps, "u1", NOW)).toBeNull();
  expect(f.since).toEqual([new Date("2026-11-26T00:00:00Z")]);
});

test.each([
  ["daily_limit", { asked: 20 }],
  ["user_budget", { userUsd: 0.5 }],
  ["user_budget", { capCents: 0 }],
  ["global_budget", { globalUsd: 0.3 }],
] as const)(
  "refused (%s): nothing stored or queued, and the refusal counted",
  async (reason, opts) => {
    const f = fakes(opts);
    expect(await submitAsk(f.deps, CONTEXT, BODY, NOW)).toEqual({
      status: "refused",
      reason,
    });
    expect(f.enqueue).not.toHaveBeenCalled();
    expect(f.emit).toHaveBeenCalledWith(
      "ask_answered",
      { outcome: reason, citation_count: 0, cost_micro_usd: 0 },
      CONTEXT,
    );
  },
);

test("no daily limit and no budget cap: never refused for them", async () => {
  const f = fakes({ asked: 999, daily: null, capCents: null, userUsd: 9 });
  expect(await askRefusal(f.deps, "u1", NOW)).toBeNull();
});

test("a question that can't be queued is dropped, so the user can ask again", async () => {
  const f = fakes({ enqueue: () => Promise.reject(new Error("down")) });
  await expect(submitAsk(f.deps, CONTEXT, BODY, NOW)).rejects.toThrow("down");
  expect(f.dropped).toEqual(["q1"]);
  expect(f.emit).not.toHaveBeenCalled();
});

test("following a space adds its topic; unfollowing never leaves none (PER-1)", () => {
  const offered = ["databases", "backend"] as const;
  expect(followedTopics(["databases"], "backend", true, offered)).toEqual([
    "databases",
    "backend",
  ]);
  expect(followedTopics(["databases"], "databases", true, offered)).toEqual([
    "databases",
  ]);
  expect(
    followedTopics(["databases"], "software-design", true, offered),
  ).toBeNull();
  expect(
    followedTopics(["databases", "backend"], "databases", false, offered),
  ).toEqual(["backend"]);
  expect(followedTopics(["databases"], "databases", false, offered)).toBeNull();
});

test("learner counts show only above 50", () => {
  expect(learnersLabel(50)).toBeNull();
  expect(learnersLabel(51)).toBe("51 learners");
  expect(learnersLabel(3249)).toBe("3.2k learners");
  expect(learnersLabel(5000)).toBe("5k learners");
});

test("a retry of a stored question gets it back past today's limit, uncounted", async () => {
  const f = fakes();
  await submitAsk(f.deps, CONTEXT, BODY, NOW);
  const limited = fakes({ asked: 20 });
  // The same store: the question is already there under its key.
  const stored = f.deps.asks;
  limited.deps.asks = {
    ...limited.deps.asks,
    existing: (userId, key) => stored.existing(userId, key),
  };
  expect(await submitAsk(limited.deps, CONTEXT, BODY, NOW)).toEqual({
    status: "queued",
    id: "q1",
  });
  expect(limited.enqueue).not.toHaveBeenCalled();
  expect(limited.emit).not.toHaveBeenCalled();
});

const article = (id: string, minutes: number | null, conceptIds: string[]) => ({
  itemId: id,
  title: `Article ${id}`,
  sourceName: "DDIA",
  minutes,
  conceptIds,
});

test("a session puts prerequisites first, whatever their length", () => {
  // Cited sharding (needs replication), then replication, then a long one.
  const sharding = article("1", 2, ["c-shard"]);
  const replication = article("2", 2, ["c-repl"]);
  const long = article("3", 30, ["c-other"]);
  // ADR-0058: no cut to a break's minutes; every article stays, in order.
  expect(
    sessionPlan([sharding, replication, long], [["c-repl", "c-shard"]]).map(
      (a) => a.itemId,
    ),
  ).toEqual(["2", "1", "3"]);
});

test("a session keeps the top three; a cycle keeps citation order", () => {
  expect(
    sessionPlan(
      ["1", "2", "3", "4"].map((id) => article(id, null, [])),
      [],
    ).map((a) => a.itemId),
  ).toEqual(["1", "2", "3"]);
  expect(
    sessionPlan(
      [article("1", 1, ["a"]), article("2", 1, ["b"])],
      [
        ["a", "b"],
        ["b", "a"],
      ],
    ).map((a) => a.itemId),
  ).toEqual(["1", "2"]);
  expect(sessionPlan([], [])).toEqual([]);
});
