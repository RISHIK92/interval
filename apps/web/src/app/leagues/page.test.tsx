import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type {
  Actor,
  Entitlements,
  Follows,
  LeagueCohort,
  LeagueRow,
  Leaderboards,
  Leagues,
  PlayerUniversities,
  Usernames,
} from "../../server/ports";

// ADR-0045 (Leagues, web): the player's weekly league, ranked, with the zones that move
// up and down; their friends' points this week; the tiers and how leagues work.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const can = vi.fn<Entitlements["can"]>(() => Promise.resolve(true));
const usernameGet = vi.fn<Usernames["get"]>(() =>
  Promise.resolve({ username: "ada", searchable: true }),
);
const standing = vi.fn<Leagues["standing"]>();
const pointsOf = vi.fn<Leagues["pointsOf"]>(() => Promise.resolve([]));
const following = vi.fn<Follows["following"]>(() => Promise.resolve([]));
const universityGet = vi.fn<PlayerUniversities["get"]>(() =>
  Promise.resolve({ university: null, changeableFrom: null }),
);
const universityStanding = vi.fn<Leaderboards["universityStanding"]>(() =>
  Promise.resolve(null),
);
const universityCount = vi.fn<Leaderboards["universityCount"]>(() =>
  Promise.resolve(0),
);
const emit = vi.fn();
vi.mock("../../server/container", () => ({
  sessionReader: () => ({ current }),
  entitlements: () => ({ can }),
  usernames: () => ({ get: usernameGet }),
  leagues: () => ({ standing, pointsOf }),
  follows: () => ({ following }),
  playerUniversities: () => ({ get: universityGet }),
  leaderboards: () => ({ universityStanding, universityCount }),
  preferences: () => ({ get: () => Promise.resolve(null) }),
  events: () => ({ emit }),
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
  cookies: () => Promise.resolve({ get: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
  notFound: () => {
    throw new Error("not-found");
  },
}));

const account: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // Friday 18:00 UTC: 2 days 6 hours before Monday (BATTLE_WINDOW_TIME_ZONE unset: UTC).
  vi.setSystemTime(new Date("2031-03-07T18:00:00Z"));
  current.mockResolvedValue(account);
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function page(query: Record<string, string> = {}): Promise<string> {
  const { default: LeaguesPage } = await import("./page");
  return renderToStaticMarkup(
    await LeaguesPage({ searchParams: Promise.resolve(query) }),
  );
}

const row = (rank: number, over: Partial<LeagueRow> = {}): LeagueRow => ({
  userId: `p${String(rank)}`,
  username: `player${String(rank)}`,
  rank,
  points: 600 - rank * 10,
  matches: 3,
  battles: 0,
  checkpoints: 0,
  today: 0,
  ...over,
});

const thirty = (mine: number): LeagueCohort => ({
  size: 30,
  up: 7,
  down: 5,
  rows: Array.from({ length: 30 }, (_, i) =>
    i + 1 === mine
      ? row(i + 1, { userId: "u1", username: "ada", matches: 9, today: 41 })
      : row(i + 1),
  ),
});

test("signed out goes to join, a guest to sign-up, a plan without leagues gets 404", async () => {
  current.mockResolvedValueOnce(null);
  await expect(page()).rejects.toThrow("redirect:/join");
  current.mockResolvedValueOnce({ ...account, isGuest: true });
  await expect(page()).rejects.toThrow("redirect:/sign-up");
  can.mockResolvedValueOnce(false);
  await expect(page()).rejects.toThrow("not-found");
  expect(can).toHaveBeenCalledWith("u1", "play.league");
});

test("a placed player sees their league ranked, with both zones and their own row", async () => {
  standing.mockResolvedValue({ tier: "sapphire", cohort: thirty(5) });
  const html = await page();
  expect(standing).toHaveBeenCalledWith(
    "u1",
    "2031-03-03",
    new Date("2031-03-07T00:00:00Z"),
  );
  expect(html).toContain("Sapphire league");
  expect(html).toContain("30 players at your pace · ends Sunday · ");
  expect(html).toContain("2d 6h");
  expect(html).toContain("You");
  expect(html).toContain("9 matches · +41 today");
  expect(html).toContain("player4");
  expect(html).toContain("Promotion zone above · top 7 move up to Ruby");
  expect(html).toContain("Bottom 5 move down to Gold");
  // The promotion line sits after the 7th row, the demotion line before the 26th.
  expect(html.indexOf("player7")).toBeLessThan(html.indexOf("Promotion zone"));
  expect(html.indexOf("Promotion zone")).toBeLessThan(html.indexOf("player8"));
  expect(html.indexOf("player25")).toBeLessThan(html.indexOf("Bottom 5"));
  expect(html.indexOf("Bottom 5")).toBeLessThan(html.indexOf("player26"));
  expect(html).toMatch(/aria-current="true"[^>]*>.*?You/);
  // The rail: tiers, with this one and the next marked, and how leagues work.
  expect(html).toContain("Sapphire · you");
  expect(html).toContain("Ruby · next");
  expect(html).toContain(
    "Each week you’re grouped with 30 people who play about as much as you.",
  );
  expect(emit).toHaveBeenCalledWith(
    "league_viewed",
    { tab: "league" },
    expect.objectContaining({ userId: "u1" }),
  );
});

test("Diamond has no promotion zone and Bronze no demotion zone", async () => {
  standing.mockResolvedValue({
    tier: "diamond",
    cohort: { ...thirty(1), up: 0 },
  });
  const diamond = await page();
  expect(diamond).not.toContain("Promotion zone");
  expect(diamond).toContain("Bottom 5 move down to Ruby");
  standing.mockResolvedValue({
    tier: "bronze",
    cohort: { ...thirty(1), down: 0 },
  });
  const bronze = await page();
  expect(bronze).toContain("top 7 move up to Silver");
  expect(bronze).not.toContain("move down");
});

test("before their first points this week, a player is told how to join", async () => {
  standing.mockResolvedValue({ tier: "bronze", cohort: null });
  const html = await page();
  expect(html).toContain("Bronze league");
  expect(html).toContain("ends Sunday");
  expect(html).not.toContain("players at your pace ·");
  expect(html).toContain(
    "Your first points this week put you in a league with players at your pace.",
  );
  expect(html).toContain('href="/play"');
});

test("Friends ranks the player and those they follow by this week's points", async () => {
  standing.mockResolvedValue({ tier: "gold", cohort: null });
  following.mockResolvedValueOnce([
    { userId: "f1", username: "bea" },
    { userId: "f2", username: "cy" },
    { userId: "f3", username: "dot" },
  ]);
  pointsOf.mockResolvedValueOnce([
    { userId: "f2", points: 120 },
    { userId: "u1", points: 80 },
    { userId: "f1", points: 120 },
  ]);
  const html = await page({ tab: "friends" });
  expect(pointsOf).toHaveBeenCalledWith(["u1", "f1", "f2", "f3"], "2031-03-03");
  // Equal points share a rank; a player with none this week is left out.
  expect(html).toMatch(/1<\/td><td[^>]*>bea/);
  expect(html).toMatch(/1<\/td><td[^>]*>cy/);
  expect(html).toMatch(/3<\/td><td[^>]*>You/);
  expect(html).not.toContain("dot");
  expect(html).toMatch(/aria-current="page"[^>]*>Friends/);
  expect(emit).toHaveBeenCalledWith(
    "league_viewed",
    { tab: "friends" },
    expect.anything(),
  );
});

test("Friends without anyone followed points to Profile", async () => {
  standing.mockResolvedValue({ tier: "gold", cohort: null });
  const html = await page({ tab: "friends" });
  expect(html).toContain("Follow people on Profile");
  expect(pointsOf).not.toHaveBeenCalled();
});

test("University and All-time are the existing boards", async () => {
  standing.mockResolvedValue({ tier: "gold", cohort: null });
  const html = await page();
  expect(html).toContain(
    'href="/play/boards?game=season&amp;scope=universities"',
  );
  expect(html).toContain('href="/play/boards"');
});

test("the rail shows the player's university rank on the season board, unverified", async () => {
  standing.mockResolvedValue({ tier: "gold", cohort: null });
  universityGet.mockResolvedValue({
    university: { id: "7", name: "State Tech", country: "IN", listed: true },
    changeableFrom: null,
  });
  universityStanding.mockResolvedValue({
    universityId: "7",
    score: 41,
    rank: 3,
  });
  universityCount.mockResolvedValue(212);
  const html = await page();
  expect(universityStanding).toHaveBeenCalledWith("season:2031-03", "7");
  expect(html).toContain("Your university");
  expect(html).toContain("State Tech · #3 of 212");
  // ADR-0032: universities aren't verified.
  expect(html).not.toContain("Verified");
});
