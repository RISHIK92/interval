import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type {
  Actor,
  DailyStatus,
  Entitlements,
  PlayerRatings,
  Preferences,
  Usernames,
} from "../../server/ports";

// §6.3, OPS-3, ADR-0029 (P3-W13-S01): the Play tab lists the quick games, each behind a
// capability; signed-out visitors can start a guest here.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const can = vi.fn<Entitlements["can"]>(() => Promise.resolve(true));
const get = vi.fn<(userId: string) => Promise<Preferences | null>>(() =>
  Promise.resolve(null),
);
const dailyStatus = vi.fn<(userId: string) => Promise<DailyStatus>>(() =>
  Promise.resolve({ today: "open", streak: { days: 0, freezes: 0 } }),
);
const usernameGet = vi.fn<Usernames["get"]>(() =>
  Promise.resolve({ username: "ada", searchable: true }),
);
const applyEvidence = vi.fn(() => Promise.resolve());
const ratingOf = vi.fn(() => Promise.resolve(1612.4));
const adjustments = vi.fn<PlayerRatings["adjustments"]>(() =>
  Promise.resolve([]),
);
let gameConfigured = true;
vi.mock("../../env", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  gameEnv: () => (gameConfigured ? { GAME_TICKET_SECRET: "s" } : null),
}));
vi.mock("./live/evidence", () => ({ applyMatchEvidence: applyEvidence }));
vi.mock("../../server/container", () => ({
  usernames: () => ({ get: usernameGet }),
  sessionReader: () => ({ current }),
  entitlements: () => ({ can }),
  preferences: () => ({ get }),
  quizzes: () => ({ dailyStatus }),
  playerRatings: () => ({ of: ratingOf, adjustments }),
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
}));
vi.mock("./actions", () => ({ startGuestAction: vi.fn() }));
vi.mock("../quiz/actions", () => ({
  startSprintAction: vi.fn(),
  startEstimationAction: vi.fn(),
  startDailyAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const account: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };
const guest: Actor = { userId: "g1", isGuest: true, betaGroup: "student" };

afterEach(() => {
  vi.clearAllMocks();
  gameConfigured = true;
});

async function page(
  search: { sprint?: string; estimation?: string; daily?: string } = {},
): Promise<string> {
  const { default: PlayPage } = await import("./page");
  return renderToStaticMarkup(
    await PlayPage({ searchParams: Promise.resolve(search) }),
  );
}

// Tags become "|", so text across elements reads in order.
const words = (html: string) => html.replace(/<[^>]+>/g, "|");

test("four quick games, each with its format and win condition, all playable", async () => {
  current.mockResolvedValue(account);
  const html = await page();
  const text = words(html);
  const games: [string, string, string][] = [
    [
      "Daily challenge",
      "Solo, the same set for everyone, one attempt",
      "Score and streak",
    ],
    ["60-second sprint", "Solo or 1v1", "Most correct in 60 seconds"],
    ["Estimation", "Solo or 1v1", "full points within 1.25× of the answer"],
    [
      "Fastest finger",
      "1v1 live, 7 rounds",
      "First correct answer takes each round",
    ],
  ];
  for (const [name, format, win] of games) {
    expect(text).toMatch(new RegExp(`${name}\\|[^]*?${format}[^]*?${win}`));
  }
  const list = /<ul[^]*<\/ul>/.exec(html)?.[0] ?? "";
  expect(list).not.toContain("Coming later");
  expect(html).toMatch(/<a aria-current="page"[^>]*href="\/play"/);
});

test("each game asks its own capability; one the plan lacks says so", async () => {
  current.mockResolvedValue(account);
  can.mockImplementation((_user, capability) =>
    Promise.resolve(capability !== "play.live"),
  );
  const text = words(await page());
  for (const capability of [
    "play.daily",
    "play.sprint",
    "play.estimation",
    "play.live",
  ]) {
    expect(can).toHaveBeenCalledWith("u1", capability);
  }
  expect(text).toMatch(/Fastest finger\|[^]*?Not on your plan/);
  expect(text.match(/Not on your plan/g)).toHaveLength(1);
});

test("signed out: the games, a guest form with an invite code, and Join or Sign in", async () => {
  current.mockResolvedValue(null);
  const html = await page();
  expect(html).toContain("Daily challenge");
  expect(html).toMatch(/<input[^>]*name="code"/);
  expect(html).toContain("Play as a guest");
  expect(html).toMatch(/href="\/join"/);
  expect(html).toMatch(/href="\/sign-in"/);
  expect(can).not.toHaveBeenCalled();
});

test("a guest plays as a guest, with a way to keep their progress", async () => {
  current.mockResolvedValue(guest);
  const html = await page();
  expect(html).toMatch(/href="\/sign-up"[^>]*>Sign up to keep your progress/);
  // Guests have the beta plan too, so their games are gated the same way.
  expect(can).toHaveBeenCalledWith("g1", "play.daily");
  expect(html).not.toMatch(/<input[^>]*name="code"/);
});

// P3-W14-S05 (owner, 2026-11-02): an account picks its username first; a guest has none.
test("an account with no username is sent to choose one; a guest plays without", async () => {
  current.mockResolvedValue(account);
  usernameGet.mockResolvedValueOnce(null);
  await expect(page()).rejects.toThrow("redirect:/username?next=%2Fplay");
  // A guest is never asked: only the account's visit read a username.
  current.mockResolvedValue(guest);
  await expect(page()).resolves.toContain("Play");
  expect(usernameGet).toHaveBeenCalledOnce();
});

// P3-W14-S06: the boards, for anyone playing.
test("a player, account or guest, has a link to the boards; a visitor doesn't", async () => {
  current.mockResolvedValue(account);
  expect(await page()).toMatch(/<a[^>]*href="\/play\/boards"[^>]*>Boards</);
  current.mockResolvedValue(guest);
  expect(await page()).toMatch(/href="\/play\/boards"/);
  current.mockResolvedValue(null);
  expect(await page()).not.toMatch(/href="\/play\/boards"/);
});

// P3-W15-S05: a visit applies the player's finished live matches, a guest's too.
test("Play applies finished live matches' evidence for accounts and guests", async () => {
  current.mockResolvedValue(account);
  await page();
  expect(applyEvidence).toHaveBeenLastCalledWith(account);
  current.mockResolvedValue(guest);
  await page();
  expect(applyEvidence).toHaveBeenLastCalledWith(guest);
  current.mockResolvedValue(null);
  await page();
  expect(applyEvidence).toHaveBeenCalledTimes(2);
});

test("an account sees neither the guest form nor the sign-up line", async () => {
  current.mockResolvedValue(account);
  const html = await page();
  expect(html).not.toMatch(/<input[^>]*name="code"/);
  expect(html).not.toContain("Sign up to keep your progress");
});

// P3-W13-S02: the sprint is playable; the other games wait for their slices.
test("the sprint card starts a sprint; without its capability it can't", async () => {
  current.mockResolvedValue(account);
  const html = await page();
  expect(words(html)).toMatch(/60-second sprint\|[^]*?Start a sprint/);
  expect(html).toMatch(/<form[^>]*>(?:(?!<\/form>)[^])*Start a sprint/);
  can.mockImplementation((_user, capability) =>
    Promise.resolve(capability !== "play.sprint"),
  );
  const without = await page();
  expect(without).not.toContain("Start a sprint");
  expect(words(without)).toMatch(/60-second sprint\|[^]*?Not on your plan/);
});

// Q-P3-04: nothing the player wasn't asked this week; Start came back here.
test("a sprint with nothing left to ask says so", async () => {
  current.mockResolvedValue(account);
  can.mockResolvedValue(true);
  expect(await page({ sprint: "none" })).toMatch(
    /role="status"[^>]*>You&#x27;ve answered every question we have this week/,
  );
  expect(await page()).not.toContain("every question we have this week");
});

// P3-W13-S04 (§6.3): solo estimation is playable too.
test("the estimation card starts a round; without its capability it can't", async () => {
  current.mockResolvedValue(account);
  const html = await page();
  expect(words(html)).toMatch(/Estimation\|[^]*?Start a round/);
  expect(html).toMatch(/<form[^>]*>(?:(?!<\/form>)[^])*Start a round/);
  can.mockImplementation((_user, capability) =>
    Promise.resolve(capability !== "play.estimation"),
  );
  const without = await page();
  expect(without).not.toContain("Start a round");
  expect(without).toContain("Start a sprint");
  expect(words(without)).toMatch(/Estimation\|[^]*?Not on your plan/);
});

test("a round with nothing left to ask says so", async () => {
  current.mockResolvedValue(account);
  can.mockResolvedValue(true);
  expect(await page({ estimation: "none" })).toMatch(
    /role="status"[^>]*>You&#x27;ve answered every estimation question we have this week/,
  );
  expect(await page()).not.toContain("every estimation question");
});

test("signed out, every playable game points to the guest form", async () => {
  current.mockResolvedValue(null);
  const html = await page();
  // Fastest finger too: live games are configured here.
  expect(html.match(/Play as a guest below, or sign in/g)).toHaveLength(4);
});

// P3-W13-S05 (§6.3, Q-P3-07): today's challenge, one attempt, and the streak.
test("the daily challenge card starts today's set, carries on, or shows today's result", async () => {
  current.mockResolvedValue(account);
  expect(words(await page())).toMatch(
    /Daily challenge\|[^]*?Start today&#x27;s challenge/,
  );
  dailyStatus.mockResolvedValueOnce({
    today: { attemptId: "71", finished: false, points: 100 },
    streak: { days: 0, freezes: 0 },
  });
  expect(await page()).toContain("Carry on with today&#x27;s challenge");
  dailyStatus.mockResolvedValueOnce({
    today: { attemptId: "71", finished: true, points: 430 },
    streak: { days: 8, freezes: 1 },
  });
  const played = await page();
  expect(words(played)).toMatch(/Today: 430 points/);
  expect(played).toMatch(/href="\/quiz\/71\/results\?chip=3-8"/);
  expect(played).toContain("8-day streak · a freeze held");
  expect(played).not.toContain("Start today&#x27;s challenge");
  dailyStatus.mockResolvedValueOnce({
    today: "none",
    streak: { days: 0, freezes: 0 },
  });
  expect(await page()).toContain("No challenge today");
});

test("a daily start with no set today says so", async () => {
  current.mockResolvedValue(account);
  expect(await page({ daily: "none" })).toMatch(
    /role="status"[^>]*>There&#x27;s no daily challenge today/,
  );
});

// P3-W16-S04 (Q-P3-23): the sprint card offers the live 1v1 when the plan has both
// games and live games are configured; the player's quick-game rating shows on Play.
test("the sprint card links to a live 1v1 sprint, and the rating shows", async () => {
  current.mockResolvedValue(guest);
  const html = await page();
  expect(html).toContain('href="/play/live/sprint"');
  expect(words(html)).toContain("Rating 1612");
  expect(html).toContain('href="/play/boards?game=season"');
  expect(ratingOf).toHaveBeenCalledWith("g1");
});

test("no live sprint without its capability, or with live games not configured", async () => {
  current.mockResolvedValue(account);
  can.mockImplementation((_, capability) =>
    Promise.resolve(capability !== "play.live"),
  );
  expect(await page()).not.toContain("/play/live/sprint");
  can.mockImplementation(() => Promise.resolve(true));
  gameConfigured = false;
  expect(await page()).not.toContain("/play/live/sprint");
});

test("a visitor sees no rating and no live link", async () => {
  current.mockResolvedValue(null);
  const html = await page();
  expect(html).not.toContain("Rating");
  expect(html).not.toContain("/play/live/sprint");
  expect(ratingOf).not.toHaveBeenCalled();
});

// P3-W16-S05 (Q-P3-24): fastest finger is live only; it waits for live games configured.
test("fastest finger plays live, or waits while live games aren't configured", async () => {
  current.mockResolvedValue(guest);
  expect(await page()).toMatch(
    /href="\/play\/live\/fastest-finger"[^>]*>Play live</,
  );
  gameConfigured = false;
  const html = await page();
  expect(html).not.toContain("/play/live/fastest-finger");
  expect(/<ul[^]*<\/ul>/.exec(html)?.[0]).toContain("Coming later");
});

// P3-W18-S02 (§6.9; owner, 2026-11-05): a confirmed fair-play penalty shows with the
// rating, as an adjustment.
test("a confirmed fair-play penalty shows under the rating", async () => {
  current.mockResolvedValue(guest);
  adjustments.mockResolvedValueOnce([
    { penalty: 23.6, playedAt: new Date("2026-11-04T10:00:00Z") },
    { penalty: 0, playedAt: new Date("2026-11-02T10:00:00Z") },
  ]);
  const text = words(await page());
  expect(text).toContain("Fair-play adjustment: −24 (match of 4 Nov 2026)");
  expect(text).toContain(
    "Fair-play adjustment: no rating removed (match of 2 Nov 2026)",
  );
  expect(adjustments).toHaveBeenCalledWith("g1");
});

test("no penalty, no adjustment line", async () => {
  current.mockResolvedValue(guest);
  expect(await page()).not.toContain("Fair-play adjustment");
});
