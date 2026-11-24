import { POOL } from "@interval/hld";
import { afterEach, expect, test, vi } from "vitest";
import type { Actor, HldTournaments } from "../../../server/ports";

// P6-W43 (§6.4, Q-P6-07), ADR-0050 §6, Q-WD-31: a cup's rounds are pooled variants on a
// spec version in effect when it starts; 2.0 from its season boundary (1 December UTC).
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const can = vi.fn<(userId: string, capability: string) => Promise<boolean>>();
const create = vi.fn<HldTournaments["create"]>(() => Promise.resolve("t1"));
vi.mock("../../../server/container", () => ({
  sessionReader: () => ({ current }),
  entitlements: () => ({ can }),
  hldTournaments: () => ({ create }),
  tournamentDeps: () => ({}),
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

afterEach(() => {
  vi.clearAllMocks();
});

const form = (family: string, startsAt: string) => {
  const data = new FormData();
  data.set("name", "December cup");
  data.set("battleMode", "human");
  data.set("startsAt", startsAt);
  for (const [i, seed] of (POOL[family]?.human ?? []).slice(0, 8).entries())
    data.set(`round${String(i + 1)}`, `${family}/${String(seed)}`);
  return data;
};

test("a cup on a 2.0 family is refused before the boundary and made from it", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);
  const { createTournamentAction } = await import("./actions");
  await expect(
    createTournamentAction(form("file-sync", "2026-11-30T23:59")),
  ).rejects.toThrow("redirect:/admin/hld-tournaments?error=invalid");
  expect(create).not.toHaveBeenCalled();
  await expect(
    createTournamentAction(form("file-sync", "2026-12-01T00:00")),
  ).rejects.toThrow("redirect:/admin/hld-tournaments?saved=t1");
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({ startsAt: new Date("2026-12-01T00:00:00Z") }),
    "a1",
  );
});

// Q-WD-31: 2.1's families from its own boundary, a month after 2.0's.
test("a cup on a 2.1 family is refused before 2027-01-01 and made from it", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);
  const { createTournamentAction } = await import("./actions");
  await expect(
    createTournamentAction(form("like-counters", "2026-12-31T23:59")),
  ).rejects.toThrow("redirect:/admin/hld-tournaments?error=invalid");
  expect(create).not.toHaveBeenCalled();
  await expect(
    createTournamentAction(form("like-counters", "2027-01-01T00:00")),
  ).rejects.toThrow("redirect:/admin/hld-tournaments?saved=t1");
});

test("a cup on a 1.0 family can start before the boundary", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);
  const { createTournamentAction } = await import("./actions");
  await expect(
    createTournamentAction(form("chat", "2026-11-25T18:00")),
  ).rejects.toThrow("redirect:/admin/hld-tournaments?saved=t1");
});

test("only admin.review makes a cup", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(false);
  const { createTournamentAction } = await import("./actions");
  await expect(
    createTournamentAction(form("chat", "2026-11-25T18:00")),
  ).rejects.toThrow("notFound");
  expect(create).not.toHaveBeenCalled();
});
