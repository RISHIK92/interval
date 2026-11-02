import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type { Actor, Entitlements } from "../../../../server/ports";

// P3-W16-S05 (Q-P3-24): live fastest finger, for a player (account or guest) whose plan
// has live games, once they are configured; Play otherwise.
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
  const { default: LiveFingerPage } = await import("./page");
  return renderToStaticMarkup(await LiveFingerPage());
}

test("a guest or an account gets the queue; an account needs its username", async () => {
  current.mockResolvedValue(guest);
  expect(await page()).toContain("Finding an opponent");
  expect(requireUsername).not.toHaveBeenCalled();
  current.mockResolvedValue(account);
  expect(await page()).toContain("Finding an opponent");
  expect(requireUsername).toHaveBeenCalledWith(
    "u1",
    "/play/live/fastest-finger",
  );
  expect(can.mock.calls.map(([, c]) => c)).toEqual(["play.live", "play.live"]);
});

test("signed out, without live games, or unconfigured: back to Play", async () => {
  current.mockResolvedValue(null);
  await expect(page()).rejects.toThrow("redirect:/play");
  current.mockResolvedValue(guest);
  can.mockImplementation((_, c) => Promise.resolve(c !== "play.live"));
  await expect(page()).rejects.toThrow("redirect:/play");
  can.mockImplementation(() => Promise.resolve(true));
  gameConfigured = false;
  await expect(page()).rejects.toThrow("redirect:/play");
});
