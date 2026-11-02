import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type { Actor, Entitlements } from "../../../../server/ports";

// P3-W16-S04 (Q-P3-23): the live sprint, for a player (account or guest) whose plan has
// the sprint and live games, once live games are configured; Play otherwise.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const can = vi.fn<Entitlements["can"]>(() => Promise.resolve(true));
const requireUsername = vi.fn(() => Promise.resolve());
let gameConfigured = true;
vi.mock("../../../../server/container", () => ({
  sessionReader: () => ({ current }),
  entitlements: () => ({ can }),
}));
vi.mock("../../../username/gate", () => ({ requireUsername }));
vi.mock("../../../../env", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  gameEnv: () => (gameConfigured ? { GAME_TICKET_SECRET: "s" } : null),
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
const guest: Actor = { userId: "g1", isGuest: true, betaGroup: "student" };

afterEach(() => {
  vi.clearAllMocks();
  gameConfigured = true;
});

async function page(): Promise<string> {
  const { default: LiveSprintPage } = await import("./page");
  return renderToStaticMarkup(await LiveSprintPage());
}

test("a guest or an account gets the queue; an account needs its username", async () => {
  current.mockResolvedValue(guest);
  expect(await page()).toContain("Finding an opponent");
  expect(requireUsername).not.toHaveBeenCalled();
  current.mockResolvedValue(account);
  expect(await page()).toContain("Finding an opponent");
  expect(requireUsername).toHaveBeenCalledWith("u1", "/play/live/sprint");
  expect(can.mock.calls.map(([, c]) => c).sort()).toEqual([
    "play.live",
    "play.live",
    "play.sprint",
    "play.sprint",
  ]);
});

test("signed out, without either capability, or unconfigured: back to Play", async () => {
  current.mockResolvedValue(null);
  await expect(page()).rejects.toThrow("redirect:/play");
  current.mockResolvedValue(guest);
  can.mockImplementation((_, c) => Promise.resolve(c !== "play.live"));
  await expect(page()).rejects.toThrow("redirect:/play");
  can.mockImplementation((_, c) => Promise.resolve(c !== "play.sprint"));
  await expect(page()).rejects.toThrow("redirect:/play");
  can.mockImplementation(() => Promise.resolve(true));
  gameConfigured = false;
  await expect(page()).rejects.toThrow("redirect:/play");
});
