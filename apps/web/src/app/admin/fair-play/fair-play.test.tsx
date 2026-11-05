import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type {
  Actor,
  AdminFairPlay,
  FairPlayFlagRow,
} from "../../../server/ports";

// P3-W18-S02 (§6.9, Q-P3-20): fair-play flags, for admin.review only. Flags wait here
// before any penalty; a penalty removes the match's gain (owner, 2026-11-05).
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const can = vi.fn<(userId: string, capability: string) => Promise<boolean>>();
const pending = vi.fn<AdminFairPlay["pending"]>(() => Promise.resolve([]));
const decide = vi.fn<AdminFairPlay["decide"]>(() =>
  Promise.resolve({ userId: "u9" }),
);
const invalidate = vi.fn(() => Promise.resolve());
vi.mock("../../../server/container", () => ({
  sessionReader: () => ({ current }),
  entitlements: () => ({ can }),
  adminFairPlay: () => ({ pending, decide }),
  leaderboards: () => ({ invalidate }),
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const admin: Actor = { userId: "a1", isGuest: false, betaGroup: "developer" };
const flag: FairPlayFlagRow = {
  id: "7",
  userId: "u9",
  player: "ada_l",
  matchId: "6f1c2b8e-3d4a-4e5f-9a0b-1c2d3e4f5a6b",
  mode: "fastest_finger",
  playedAt: new Date("2026-11-04T10:00:00Z"),
  signals: [
    { kind: "speed", round: 1, ms: 210 },
    { kind: "focus", round: 2, ms: null },
    { kind: "speed", round: 3, ms: 90 },
  ],
  gain: 23.6,
};

afterEach(() => {
  vi.clearAllMocks();
});

async function page(query: Record<string, string> = {}): Promise<string> {
  const { default: FairPlayPage } = await import("./page");
  return renderToStaticMarkup(
    await FairPlayPage({ searchParams: Promise.resolve(query) }),
  );
}

test("only admin.review sees the page", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(false);
  await expect(page()).rejects.toThrow("notFound");
  current.mockResolvedValue(null);
  await expect(page()).rejects.toThrow("notFound");
});

test("each flag: the player, the match, every signal and what a penalty would remove", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);
  pending.mockResolvedValue([flag]);
  const html = await page();
  expect(html).toContain("ada_l");
  expect(html).toContain("Fastest finger");
  expect(html).toContain("Round 1: answered in 210 ms");
  expect(html).toContain("Round 2: left the tab");
  expect(html).toContain("Round 3: answered in 90 ms");
  expect(html).toContain("Remove the gain (24)");
  expect(html).toContain("Dismiss");
  expect(html).toContain('value="7"');
});

test("nothing pending says so", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);
  pending.mockResolvedValue([]);
  expect(await page()).toContain("Nothing to review.");
});

test("a match that gained nothing says a penalty removes nothing", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);
  pending.mockResolvedValue([{ ...flag, gain: 0 }]);
  expect(await page()).toContain("Penalise (the match gained nothing)");
});

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

test("a penalty is decided by the admin and the player's boards are rebuilt", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);
  const { decideFairPlayAction } = await import("./actions");
  await expect(
    decideFairPlayAction(form({ flagId: "7", decision: "penalize" })),
  ).rejects.toThrow("redirect:/admin/fair-play?saved=1");
  expect(decide).toHaveBeenCalledWith("7", "a1", "penalize");
  expect(invalidate).toHaveBeenCalledWith("u9");
});

test("a dismissal moves no board; one already decided says so", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);
  const { decideFairPlayAction } = await import("./actions");
  await expect(
    decideFairPlayAction(form({ flagId: "7", decision: "dismiss" })),
  ).rejects.toThrow("redirect:/admin/fair-play?saved=1");
  expect(invalidate).not.toHaveBeenCalled();
  decide.mockResolvedValueOnce(null);
  await expect(
    decideFairPlayAction(form({ flagId: "7", decision: "penalize" })),
  ).rejects.toThrow("redirect:/admin/fair-play?error=decided");
  expect(invalidate).not.toHaveBeenCalled();
});

test("the action checks access and its fields", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);
  const { decideFairPlayAction } = await import("./actions");
  await expect(
    decideFairPlayAction(form({ flagId: "x", decision: "dismiss" })),
  ).rejects.toThrow("notFound");
  await expect(
    decideFairPlayAction(form({ flagId: "7", decision: "ban" })),
  ).rejects.toThrow("notFound");
  can.mockResolvedValue(false);
  await expect(
    decideFairPlayAction(form({ flagId: "7", decision: "dismiss" })),
  ).rejects.toThrow("notFound");
  expect(decide).not.toHaveBeenCalled();
});
