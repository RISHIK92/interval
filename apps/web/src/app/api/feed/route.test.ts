import { FeedResponse } from "@interval/api-client";
import { afterEach, expect, test, vi } from "vitest";
import type {
  Actor,
  ContinueCard,
  FeedCard,
  Preferences,
} from "../../../server/ports";

// P4-W20-S01 (§5A, Q-P4-14): Home's feed for the app, read as the PWA's is; events
// carry the phone's platform.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const prefs = vi.fn<(userId: string) => Promise<Preferences | null>>();
const read = vi.fn(() => Promise.resolve({ computed: true, cards: [card] }));
const continueCards = vi.fn<() => Promise<ContinueCard[]>>(() =>
  Promise.resolve([]),
);
const emit = vi.fn();
const can = vi.fn(() => Promise.resolve(true));
const usernameOf = vi.fn(() =>
  Promise.resolve<{ username: string; searchable: boolean } | null>({
    username: "ada",
    searchable: true,
  }),
);
const applyEvidence = vi.fn(() => Promise.resolve());
vi.mock("../../play/live/evidence", () => ({
  applyMatchEvidence: applyEvidence,
}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined }),
}));
vi.mock("../../../server/container", () => ({
  entitlements: () => ({ can }),
  usernames: () => ({ get: usernameOf }),
  sessionReader: () => ({ current }),
  preferences: () => ({ get: prefs }),
  feedReader: () => ({ read, starter: vi.fn() }),
  progress: () => ({ continueCards }),
  events: () => ({ emit }),
}));
vi.mock("../../../env", () => ({
  env: () => ({
    BETTER_AUTH_URL: "http://localhost:3100",
    NODE_ENV: "production",
  }),
}));

const card: FeedCard = {
  itemId: "5",
  articleTitle: "Raft",
  author: null,
  sourceName: "A blog",
  estimatedMinutes: 6,
  state: "continue_reading",
  reasons: { text: "On your path", kinds: ["goal_match"] },
  projectNote: null,
  saved: false,
  frameable: true,
  topic: "distributed-systems",
  difficulty: "intermediate",
};
const account: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };
const chosen = {
  topics: ["distributed-systems"],
  level: "intermediate",
  onboardedAt: new Date(),
} as unknown as Preferences;
const APP = { "expo-origin": "interval://", "interval-platform": "ios" };

afterEach(() => {
  vi.clearAllMocks();
});

const get = async (query = "", headers: Record<string, string> = APP) => {
  const { GET } = await import("./route");
  return GET(
    new Request(`http://localhost:3100/api/feed${query}`, { headers }),
  );
};

// ADR-0058: one list of article cards, no chip.
test("the app gets its cards, in the shape it parses, and a feed_viewed from ios", async () => {
  current.mockResolvedValue(account);
  prefs.mockResolvedValue(chosen);
  const response = await get();
  expect(response.status).toBe(200);
  const body = FeedResponse.parse(await response.json());
  expect(body).toEqual({ cards: [card] });
  expect(read).toHaveBeenCalledWith("u1", expect.any(Number));
  expect(emit).toHaveBeenCalledWith(
    "feed_viewed",
    { card_count: 1 },
    expect.objectContaining({ userId: "u1", source: "ios" }),
  );
});

test("a card already in Continue reading isn't offered again", async () => {
  current.mockResolvedValue(account);
  prefs.mockResolvedValue(chosen);
  continueCards.mockResolvedValueOnce([
    { itemId: "5" } as unknown as ContinueCard,
  ]);
  read.mockResolvedValueOnce({
    computed: true,
    cards: [card, { ...card, itemId: "6" }],
  });
  const body = FeedResponse.parse(await (await get()).json());
  expect(body.cards.map((c) => c.itemId)).toEqual(["6"]);
});

test("signed out, a guest, not onboarded or another site: refused", async () => {
  current.mockResolvedValue(null);
  expect((await get()).status).toBe(401);
  current.mockResolvedValue({ ...account, isGuest: true });
  expect((await get()).status).toBe(401);
  current.mockResolvedValue(account);
  prefs.mockResolvedValue(null);
  expect((await get()).status).toBe(409);
  prefs.mockResolvedValue(chosen);
  expect((await get("", {})).status).toBe(403);
});

// ADR-0036: the feed's capability, as Home checks it.
test("a plan without the feed gets 403", async () => {
  current.mockResolvedValue(account);
  prefs.mockResolvedValue(chosen);
  can.mockResolvedValueOnce(false);
  expect((await get()).status).toBe(403);
  expect(can).toHaveBeenCalledWith("u1", "feed.read");
});

// ADR-0058: the CLI and the VS Code extension still send ?chip=, even a value that was
// never a chip; it is ignored. As Home: finished live matches applied; a username
// first.
test("a chip sent is ignored; a username and setup are named", async () => {
  current.mockResolvedValue(account);
  prefs.mockResolvedValue(chosen);
  for (const query of ["?chip=1-3", "?chip=2-4"]) {
    const response = await get(query);
    expect(response.status).toBe(200);
    expect(FeedResponse.parse(await response.json())).toEqual({
      cards: [card],
    });
  }
  expect(read).toHaveBeenCalledWith("u1", expect.any(Number));
  expect(applyEvidence).toHaveBeenCalled();
  usernameOf.mockResolvedValueOnce(null);
  const noName = await get();
  expect(noName.status).toBe(409);
  expect(await noName.json()).toEqual({ setup: "username" });
  prefs.mockResolvedValueOnce(null);
  expect(await (await get()).json()).toEqual({ setup: "onboarding" });
});
