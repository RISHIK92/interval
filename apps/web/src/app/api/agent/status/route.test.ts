import { AgentStatus } from "@interval/api-client";
import { afterEach, expect, test, vi } from "vitest";
import type {
  Actor,
  AgentHook,
  FeedCard,
  FeedReader,
  Preferences,
  RateLimits,
} from "../../../../server/ports";
import { GET } from "./route";

// P7-W46 (§7; Q-P7-02, owner 2026-11-20 and 2026-11-27): the companion surfaces'
// read: the hook's device token, its capability, its own rate limit; the task as the
// hooks reported it and 3 links into the web app, nothing else.
const actor: Actor = { userId: "u1", isGuest: false, betaGroup: "developer" };
const deviceFor = vi.fn<AgentHook["deviceFor"]>(() =>
  Promise.resolve({ deviceId: "d1", actor }),
);
const running = vi.fn<AgentHook["running"]>(() => Promise.resolve(null));
const finished = vi.fn<AgentHook["finished"]>(() => Promise.resolve(null));
const allow = vi.fn<RateLimits["allow"]>(() => Promise.resolve(true));
const can = vi.fn<(userId: string, capability: string) => Promise<boolean>>(
  () => Promise.resolve(true),
);
const chosen = {
  goals: [],
  topics: ["backend"],
  level: "beginner",
  onboardedAt: new Date("2026-01-01T00:00:00Z"),
  firstName: "Ada",
} as const;
const get = vi.fn<() => Promise<(Preferences & { onboardedAt: Date }) | null>>(
  () =>
    Promise.resolve(chosen as unknown as Preferences & { onboardedAt: Date }),
);
const card: FeedCard = {
  itemId: "10",
  estimatedMinutes: 2,
  articleTitle: "Consensus in practice",
  author: null,
  sourceName: "Example Engineering",
  reasons: { text: "Because you follow Raft", kinds: ["topic_match"] },
  projectNote: { text: "Your repo uses etcd", repositories: ["a/b"] },
  saved: false,
  frameable: true,
  topic: null,
  difficulty: null,
  state: "unread",
};
const read = vi.fn<FeedReader["read"]>(() =>
  Promise.resolve({
    computed: true,
    cards: [
      card,
      { ...card, itemId: "11", frameable: false, articleTitle: "Terms" },
      { ...card, itemId: "12", estimatedMinutes: null, articleTitle: "Leases" },
      { ...card, itemId: "13" },
    ],
  }),
);
const starter = vi.fn<FeedReader["starter"]>(() =>
  Promise.resolve([{ ...card, articleTitle: "Starter pick" }]),
);
vi.mock("../../../../server/container", () => ({
  entitlements: () => ({ can }),
  agentHook: () => ({ deviceFor, running, finished }),
  rateLimits: () => ({ allow }),
  preferences: () => ({ get }),
  feedReader: () => ({ read, starter }),
}));
vi.mock("../../../../env", () => ({
  env: () => ({ BETTER_AUTH_URL: "https://interval.test" }),
}));

afterEach(() => {
  vi.clearAllMocks();
});

const TOKEN = `ivd_${"a".repeat(43)}`;
const call = (query = "", auth: string | null = `Bearer ${TOKEN}`) =>
  GET(
    new Request(`http://localhost:3100/api/agent/status${query}`, {
      headers: auth === null ? {} : { authorization: auth },
    }),
  );

// ADR-0058: no chip; each suggestion is an article.
test("the task and 3 links into the web app; nothing else", async () => {
  const response = await call();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body: unknown = await response.json();
  expect(AgentStatus.strict().parse(body)).toEqual({
    task: { state: "idle" },
    suggestions: [
      {
        title: "Consensus in practice",
        minutes: 2,
        url: "https://interval.test/read/10?pos=1&via=agent",
      },
      {
        title: "Terms",
        minutes: 2,
        url: "https://interval.test/out?item=11&pos=2&via=agent&target=article",
      },
      {
        title: "Leases",
        minutes: null,
        url: "https://interval.test/read/12?pos=3&via=agent",
      },
    ],
  });
  // No card content travels: not the reasons, the AI note, the source or the author.
  const text = JSON.stringify(body);
  for (const leak of ["Because you follow", "etcd", "Example Engineering"])
    expect(text).not.toContain(leak);
  expect(read).toHaveBeenCalledWith("u1", 3);
  // A read leaves Profile's "Last used" to the hook.
  expect(deviceFor).toHaveBeenCalledWith(TOKEN, expect.any(Date), false);
  // Its own limit, apart from the hook's start and finish.
  expect(allow).toHaveBeenCalledWith("agent-status:d1", 60, 60);
  expect(can).toHaveBeenCalledWith("u1", "agent.hook");
});

// ADR-0058: the CLI and the extension still send ?chip=; it is ignored, whatever it is.
test("running with its seconds; finished for its 10 minutes; a chip sent is ignored", async () => {
  running.mockResolvedValueOnce({ startedAt: new Date(Date.now() - 90_500) });
  const asked = await call("?chip=huge");
  expect(asked.status).toBe(200);
  const run = AgentStatus.parse(await asked.json());
  expect(run.task).toMatchObject({ state: "running" });
  expect(
    run.task.state === "running" && run.task.seconds,
  ).toBeGreaterThanOrEqual(90);
  expect(read).toHaveBeenCalledWith("u1", 3);
  const at = new Date("2031-01-01T12:00:00Z");
  finished.mockResolvedValueOnce({ finishedAt: at });
  expect(AgentStatus.parse(await (await call()).json()).task).toEqual({
    state: "finished",
    finishedAt: at.toISOString(),
  });
});

test("no suggestions before onboarding or on a plan without the feed", async () => {
  get.mockResolvedValueOnce(null);
  const before = AgentStatus.parse(await (await call()).json());
  expect(before).toEqual({
    task: { state: "idle" },
    suggestions: [],
  });
  can.mockImplementation((_user, capability) =>
    Promise.resolve(capability !== "feed.read"),
  );
  const plan = AgentStatus.parse(await (await call()).json());
  expect(plan.suggestions).toEqual([]);
  expect(read).not.toHaveBeenCalled();
  can.mockImplementation(() => Promise.resolve(true));
});

test("refused: no token, an unknown one, over the limit, the plan", async () => {
  expect((await call("", null)).status).toBe(401);
  expect((await call("", "Bearer nope")).status).toBe(401);
  deviceFor.mockResolvedValueOnce(null);
  expect((await call()).status).toBe(401);
  allow.mockResolvedValueOnce(false);
  const limited = await call();
  expect(limited.status).toBe(429);
  expect(limited.headers.get("retry-after")).toBe("60");
  can.mockResolvedValueOnce(false);
  expect((await call()).status).toBe(403);
  expect((await call("?chip=huge", null)).status).toBe(401);
  expect(running).not.toHaveBeenCalled();
});

test("no stored feed yet: the starter, at once, never waiting for a recompute", async () => {
  read.mockResolvedValueOnce({ computed: false, cards: [] });
  const body = AgentStatus.parse(await (await call()).json());
  expect(body.suggestions.map((s) => s.title)).toEqual(["Starter pick"]);
  expect(starter).toHaveBeenCalledWith("u1", "backend", "beginner", 3);
  expect(read).toHaveBeenCalledTimes(1);
});
