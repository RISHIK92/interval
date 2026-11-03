import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type { Actor, Entitlements } from "../../../server/ports";

// P3-W17-S03 (Q-P3-16): making a challenge: the games the plan has, then the link.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const can = vi.fn<Entitlements["can"]>(() => Promise.resolve(true));
vi.mock("../../../server/container", () => ({
  sessionReader: () => ({ current }),
  entitlements: () => ({ can }),
}));
vi.mock("../../username/gate", () => ({ requireUsername: vi.fn() }));
vi.mock("./actions", () => ({ createChallengeAction: vi.fn() }));
vi.mock("../../../env", () => ({
  gameEnv: () => ({ GAME_TICKET_SECRET: "s" }),
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const guest: Actor = { userId: "g1", isGuest: true, betaGroup: "student" };

afterEach(() => {
  vi.clearAllMocks();
});

async function page(t?: string): Promise<string> {
  const { default: ChallengePage } = await import("./page");
  return renderToStaticMarkup(
    await ChallengePage({
      searchParams: Promise.resolve(t === undefined ? {} : { t }),
    }),
  );
}

test("both games, or fastest finger alone when the plan has no sprint", async () => {
  current.mockResolvedValue(guest);
  const both = await page();
  expect(both).toContain("60-second sprint");
  expect(both).toContain("Fastest finger");
  can.mockImplementation((_, c) => Promise.resolve(c !== "play.sprint"));
  const one = await page();
  expect(one).not.toContain("60-second sprint");
  expect(one).toContain("Fastest finger");
});

test("a made link is shown; a token of another shape isn't", async () => {
  current.mockResolvedValue(guest);
  expect(await page("AbCdEfGhIjKlMnOpQrStUv")).toContain(
    "/c/AbCdEfGhIjKlMnOpQrStUv",
  );
  const junk = await page("<script>");
  expect(junk).not.toContain("/c/");
  expect(junk).toContain("Which game?");
});
