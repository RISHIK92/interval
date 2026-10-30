import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type { Actor, Entitlements, Preferences } from "../../server/ports";

// §6.3, OPS-3, ADR-0029 (P3-W13-S01): the Play tab lists the quick games, each behind a
// capability; signed-out visitors can start a guest here.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const can = vi.fn<Entitlements["can"]>(() => Promise.resolve(true));
const get = vi.fn<(userId: string) => Promise<Preferences | null>>(() =>
  Promise.resolve(null),
);
vi.mock("../../server/container", () => ({
  sessionReader: () => ({ current }),
  entitlements: () => ({ can }),
  preferences: () => ({ get }),
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
}));
vi.mock("./actions", () => ({ startGuestAction: vi.fn() }));

const account: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };
const guest: Actor = { userId: "g1", isGuest: true, betaGroup: "student" };

afterEach(() => {
  vi.clearAllMocks();
});

async function page(): Promise<string> {
  const { default: PlayPage } = await import("./page");
  return renderToStaticMarkup(await PlayPage());
}

// Tags become "|", so text across elements reads in order.
const words = (html: string) => html.replace(/<[^>]+>/g, "|");

test("four quick games, each with its format and win condition, none playable yet", async () => {
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
    expect(text).toMatch(
      new RegExp(`${name}\\|[^]*?${format}[^]*?${win}[^]*?Coming later`),
    );
  }
  const list = /<ul[^]*<\/ul>/.exec(html)?.[0] ?? "";
  expect(list.match(/Coming later/g)).toHaveLength(4);
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

test("an account sees neither the guest form nor the sign-up line", async () => {
  current.mockResolvedValue(account);
  const html = await page();
  expect(html).not.toMatch(/<input[^>]*name="code"/);
  expect(html).not.toContain("Sign up to keep your progress");
});
