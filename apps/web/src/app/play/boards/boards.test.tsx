import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type {
  Actor,
  Follows,
  Leaderboards,
  PlayerCountries,
  PlayerUniversities,
  Standing,
  Usernames,
} from "../../../server/ports";

// P3-W14-S06 (§6.7; owner, 2026-11-02): the boards, top 50 of the current or previous
// period, the player's own row always visible.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const usernameGet = vi.fn<Usernames["get"]>(() =>
  Promise.resolve({ username: "ada", searchable: true }),
);
const labels = vi.fn<Usernames["labels"]>((ids) =>
  Promise.resolve(
    ids.map((userId) => ({
      userId,
      username: userId.startsWith("g") ? null : `name_${userId}`,
      guest: userId.startsWith("g"),
    })),
  ),
);
const following = vi.fn<Follows["following"]>(() => Promise.resolve([]));
const top = vi.fn<Leaderboards["top"]>(() => Promise.resolve([]));
const standing = vi.fn<Leaderboards["standing"]>(() => Promise.resolve(null));
const size = vi.fn<Leaderboards["size"]>(() => Promise.resolve(0));
const among = vi.fn<Leaderboards["among"]>(() => Promise.resolve([]));
const universities = vi.fn<Leaderboards["universities"]>(() =>
  Promise.resolve([]),
);
const universityStanding = vi.fn<Leaderboards["universityStanding"]>(() =>
  Promise.resolve(null),
);
const universityCount = vi.fn<Leaderboards["universityCount"]>(() =>
  Promise.resolve(0),
);
const countryGet = vi.fn<PlayerCountries["get"]>(() =>
  Promise.resolve({ country: "IN", changeableFrom: null }),
);
const universityGet = vi.fn<PlayerUniversities["get"]>(() =>
  Promise.resolve({
    university: { id: "7", name: "IIT Delhi", country: "IN", listed: true },
    changeableFrom: null,
  }),
);
const names = vi.fn<PlayerUniversities["names"]>((ids) =>
  Promise.resolve(
    ids.map((id) => ({
      id,
      name: `University ${id}`,
      country: "IN",
      listed: true,
    })),
  ),
);
vi.mock("../../../server/container", () => ({
  sessionReader: () => ({ current }),
  usernames: () => ({ get: usernameGet, labels }),
  follows: () => ({ following }),
  leaderboards: () => ({
    top,
    standing,
    size,
    among,
    universities,
    universityStanding,
    universityCount,
  }),
  playerCountries: () => ({ get: countryGet }),
  playerUniversities: () => ({ get: universityGet, names }),
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const account: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };
const guest: Actor = { userId: "g9", isGuest: true, betaGroup: "student" };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-04T12:00:00Z")); // a Wednesday, 2026-W45
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function page(query: Record<string, string> = {}): Promise<string> {
  const { default: BoardsPage } = await import("./page");
  return renderToStaticMarkup(
    await BoardsPage({ searchParams: Promise.resolve(query) }),
  );
}

const rows = (count: number, from = 1): Standing[] =>
  Array.from({ length: count }, (_, i) => ({
    userId: `p${String(from + i)}`,
    score: 1000 - i,
    rank: from + i,
  }));

test("nobody signed in goes to join; an account without a username picks one", async () => {
  current.mockResolvedValue(null);
  await expect(page()).rejects.toThrow("redirect:/join");
  current.mockResolvedValue(account);
  usernameGet.mockResolvedValueOnce(null);
  await expect(page()).rejects.toThrow(
    "redirect:/username?next=%2Fplay%2Fboards",
  );
});

test("by default today's daily board, global, top 50 with names", async () => {
  current.mockResolvedValue(account);
  top.mockResolvedValueOnce([
    { userId: "u1", score: 380, rank: 1 },
    { userId: "g4", score: 300, rank: 2 },
  ]);
  const html = await page();
  expect(top).toHaveBeenCalledExactlyOnceWith(
    "daily:2026-11-04",
    50,
    undefined,
  );
  expect(html).toContain("@name_u1");
  expect(html).toMatch(/Guest \d{4}/);
  expect(html).toContain("You");
  expect(html).toContain("380");
  // Chips: the chosen ones are current.
  expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*>Daily</);
  expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*>Global</);
  expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*>Today</);
});

test("inside the top 50 the player's row is still pinned, with rank and percentile", async () => {
  current.mockResolvedValue(account);
  top.mockResolvedValueOnce([
    { userId: "b2", score: 400, rank: 1 },
    { userId: "u1", score: 380, rank: 2 },
  ]);
  standing.mockResolvedValueOnce({ userId: "u1", score: 380, rank: 2 });
  size.mockResolvedValueOnce(4);
  const html = await page();
  expect(standing).toHaveBeenCalledWith("daily:2026-11-04", "u1", undefined);
  expect(html).toMatch(/sticky[^>]*>[^]*?@name_u1[^]*?#2 · top 50%/);
  expect(html).not.toContain("not on this board yet");
});

test.each([
  [1, 1000, "#1 · top 1%"],
  [1000, 1000, "#1000 · top 100%"],
  [3, 3, "#3 · top 100%"],
])("rank %i of %i reads %s", async (rank, total, text) => {
  current.mockResolvedValue(account);
  standing.mockResolvedValueOnce({ userId: "u1", score: 1, rank });
  size.mockResolvedValueOnce(total);
  expect(await page()).toContain(text);
});

test("an account not yet asked for a username shows as Player; a guest's own row is pinned too", async () => {
  current.mockResolvedValue(guest);
  labels.mockImplementationOnce((ids) =>
    Promise.resolve(
      ids.map((userId) => ({ userId, username: null, guest: false })),
    ),
  );
  top.mockResolvedValueOnce([{ userId: "x1", score: 5, rank: 1 }]);
  standing.mockResolvedValueOnce({ userId: "g9", score: 3, rank: 2 });
  size.mockResolvedValueOnce(2);
  const html = await page();
  expect(html).toContain("Player");
  expect(html).toMatch(/sticky[^>]*>[^]*?Guest \d{4}[^]*?#2 · top 100%/);
});

test("outside the top 50, the player's row is pinned with rank and percentile", async () => {
  current.mockResolvedValue(account);
  top.mockResolvedValueOnce(rows(50));
  standing.mockResolvedValueOnce({ userId: "u1", score: 12, rank: 134 });
  size.mockResolvedValueOnce(1000);
  const html = await page({ game: "sprint" });
  expect(top).toHaveBeenCalledWith("sprint:2026-W45", 50, undefined);
  expect(standing).toHaveBeenCalledWith("sprint:2026-W45", "u1", undefined);
  expect(html).toContain("#134");
  expect(html).toContain("top 14%");
});

test("not on the board yet says how to join it", async () => {
  current.mockResolvedValue(account);
  const html = await page({ game: "estimation", period: "previous" });
  expect(top).toHaveBeenCalledWith("estimation:2026-W44", 50, undefined);
  expect(html).toContain("You&#x27;re not on this board yet");
});

test("country and university boards use the player's own", async () => {
  current.mockResolvedValue(account);
  await page({ scope: "country" });
  expect(top).toHaveBeenLastCalledWith("daily:2026-11-04", 50, {
    country: "IN",
  });
  await page({ scope: "university" });
  expect(top).toHaveBeenLastCalledWith("daily:2026-11-04", 50, {
    university: "7",
  });
});

test("no country or university set: a link to Profile, no board", async () => {
  current.mockResolvedValue(account);
  countryGet.mockResolvedValueOnce({ country: null, changeableFrom: null });
  const html = await page({ scope: "country" });
  expect(html).toContain("Set your country on Profile");
  expect(html).toMatch(/href="\/profile"/);
  universityGet.mockResolvedValueOnce({
    university: null,
    changeableFrom: null,
  });
  expect(await page({ scope: "university" })).toContain(
    "Set your university on Profile",
  );
  expect(top).not.toHaveBeenCalled();
});

test("friends: the player and those they follow, ranked among themselves", async () => {
  current.mockResolvedValue(account);
  following.mockResolvedValueOnce([{ userId: "b2", username: "bob" }]);
  among.mockResolvedValueOnce([
    { userId: "b2", score: 9, rank: 1 },
    { userId: "u1", score: 7, rank: 2 },
  ]);
  const html = await page({ scope: "friends", game: "sprint" });
  expect(among).toHaveBeenCalledExactlyOnceWith("sprint:2026-W45", [
    "u1",
    "b2",
  ]);
  expect(html).toContain("@name_b2");
  following.mockResolvedValueOnce([]);
  expect(await page({ scope: "friends" })).toContain(
    "Follow people on Profile",
  );
});

test("friends: the top 50 only, the player pinned when further down, or told to play", async () => {
  current.mockResolvedValue(account);
  following.mockResolvedValue([{ userId: "b2", username: "bob" }]);
  among.mockResolvedValueOnce([
    ...rows(60),
    { userId: "u1", score: 1, rank: 61 },
  ]);
  const html = await page({ scope: "friends" });
  expect(html).not.toContain("@name_p51");
  expect(html).toContain("@name_p50");
  expect(html).toMatch(/sticky[^>]*>[^]*?@name_u1[^]*?#61 · top 100%/);
  among.mockResolvedValueOnce([{ userId: "b2", score: 9, rank: 1 }]);
  expect(await page({ scope: "friends" })).toContain(
    "You&#x27;re not on this board yet",
  );
  following.mockResolvedValue([]);
});

test("universities ranked by average, the player's highlighted, pinned when outside", async () => {
  current.mockResolvedValue(account);
  universities.mockResolvedValueOnce([
    { universityId: "3", score: 412.5, rank: 1 },
    { universityId: "7", score: 380, rank: 2 },
  ]);
  const html = await page({ scope: "universities" });
  expect(universities).toHaveBeenCalledExactlyOnceWith("daily:2026-11-04", 50);
  expect(html).toContain("University 3");
  expect(html).toContain("412.5");
  expect(html).toMatch(/University 7[^]*?Yours/);
});

test("the player's university outside the top 50 is pinned with rank and percentile", async () => {
  current.mockResolvedValue(account);
  universities.mockResolvedValueOnce([
    { universityId: "3", score: 412.5, rank: 1 },
  ]);
  universityStanding.mockResolvedValueOnce({
    universityId: "7",
    score: 12,
    rank: 80,
  });
  universityCount.mockResolvedValueOnce(160);
  const html = await page({ scope: "universities" });
  expect(universityStanding).toHaveBeenCalledWith("daily:2026-11-04", "7");
  expect(html).toMatch(/sticky[^>]*>[^]*?University 7[^]*?#80 · top 50%/);
});

test("universities: no university, or one without a score, is said so", async () => {
  current.mockResolvedValue(account);
  expect(await page({ scope: "universities" })).toContain(
    "Your university isn&#x27;t on this board yet",
  );
  universityGet.mockResolvedValueOnce({
    university: null,
    changeableFrom: null,
  });
  const html = await page({ scope: "universities" });
  expect(html).toContain("Set your university on Profile");
  // Only the first view, which had a university, asked for its standing.
  expect(universityStanding).toHaveBeenCalledOnce();
});

test("a guest sees global and universities only; other scopes fall back to global", async () => {
  current.mockResolvedValue(guest);
  const html = await page({ scope: "friends" });
  expect(usernameGet).not.toHaveBeenCalled();
  expect(among).not.toHaveBeenCalled();
  expect(top).toHaveBeenCalledWith("daily:2026-11-04", 50, undefined);
  expect(html).not.toContain(">Friends<");
  expect(html).not.toContain(">Country<");
  expect(html).toContain(">Universities<");
});

test("unknown query values fall back to the defaults", async () => {
  current.mockResolvedValue(account);
  await page({ game: "chess", scope: "galaxy", period: "tomorrow" });
  expect(top).toHaveBeenCalledWith("daily:2026-11-04", 50, undefined);
});

// P3-W16-S06 (Q-P3-13): the month's quick-game rating board, rounded ratings, this
// season or the last.
test("the season board ranks ratings for this month or the last", async () => {
  current.mockResolvedValue(account);
  top.mockResolvedValue([{ userId: "u1", score: 1623.6, rank: 1 }]);
  const html = await page({ game: "season" });
  expect(top).toHaveBeenLastCalledWith("season:2026-11", 50, undefined);
  expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*>Season</);
  expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*>This season</);
  expect(html).toContain("1624");
  expect(html).not.toContain("1623.6");
  expect(html).toContain("Quick-game rating");
  await page({ game: "season", period: "previous" });
  expect(top).toHaveBeenLastCalledWith("season:2026-10", 50, undefined);
});
