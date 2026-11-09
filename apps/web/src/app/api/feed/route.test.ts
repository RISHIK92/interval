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
  kind: "moment",
  itemId: "5",
  momentId: "9",
  articleTitle: "Raft",
  author: null,
  sourceName: "A blog",
  sectionTitle: "Leader election",
  sectionNumber: 2,
  sectionCount: 5,
  estimatedMinutes: 6,
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
  breakLength: "3-8",
  onboardedAt: new Date(),
} as unknown as Preferences;
const APP = { "expo-origin": "interval://", "interval-platform": "ios" };

afterEach(() => {
  vi.clearAllMocks();
});

const get = async (
  query = "?chip=3-8",
  headers: Record<string, string> = APP,
) => {
  const { GET } = await import("./route");
  return GET(
    new Request(`http://localhost:3100/api/feed${query}`, { headers }),
  );
};

test("the app gets its chip's cards, in the shape it parses, and a feed_viewed from ios", async () => {
  current.mockResolvedValue(account);
  prefs.mockResolvedValue(chosen);
  const response = await get();
  expect(response.status).toBe(200);
  const body = FeedResponse.parse(await response.json());
  expect(body).toEqual({ chip: "3-8", cards: [card] });
  expect(read).toHaveBeenCalledWith("u1", "3-8", expect.any(Number));
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

test("signed out, a guest, not onboarded, another site or a bad chip: refused", async () => {
  current.mockResolvedValue(null);
  expect((await get()).status).toBe(401);
  current.mockResolvedValue({ ...account, isGuest: true });
  expect((await get()).status).toBe(401);
  current.mockResolvedValue(account);
  prefs.mockResolvedValue(null);
  expect((await get()).status).toBe(409);
  prefs.mockResolvedValue(chosen);
  expect((await get("?chip=3-8", {})).status).toBe(403);
  expect((await get("?chip=2-4")).status).toBe(400);
});

// ADR-0036: the feed's capability, as Home checks it.
test("a plan without the feed gets 403", async () => {
  current.mockResolvedValue(account);
  prefs.mockResolvedValue(chosen);
  can.mockResolvedValueOnce(false);
  expect((await get()).status).toBe(403);
  expect(can).toHaveBeenCalledWith("u1", "feed.read");
});

// As Home: the chip the user chose at onboarding when none is asked for; finished live
// matches applied; a username first.
test("no chip asked: the onboarding one; a username and setup are named", async () => {
  current.mockResolvedValue(account);
  prefs.mockResolvedValue({ ...chosen, breakLength: "1-3" });
  const body = FeedResponse.parse(await (await get("")).json());
  expect(body.chip).toBe("1-3");
  expect(applyEvidence).toHaveBeenCalled();
  usernameOf.mockResolvedValueOnce(null);
  const noName = await get();
  expect(noName.status).toBe(409);
  expect(await noName.json()).toEqual({ setup: "username" });
  prefs.mockResolvedValueOnce(null);
  expect(await (await get()).json()).toEqual({ setup: "onboarding" });
});
