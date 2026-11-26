import { expect, test, vi } from "vitest";
import {
  leagueWeek,
  queueLeaguePoints,
  tierAbove,
  tierBelow,
  timeLeft,
  weekSoFar,
} from "./leagues";
import type { JobQueue } from "./ports";

// ADR-0045: a league runs Monday 00:00 to Sunday 23:59:59 in the battle windows' zone.
test("the week starts on Monday and ends at next Monday 00:00 in the zone", () => {
  // Sunday 20:00 UTC: still Sunday in UTC, already Monday in Kolkata.
  const now = new Date("2031-03-09T20:00:00Z");
  expect(leagueWeek(now, "UTC")).toEqual({
    start: "2031-03-03",
    endsAt: new Date("2031-03-10T00:00:00Z"),
    todayFrom: new Date("2031-03-09T00:00:00Z"),
  });
  expect(leagueWeek(now, "Asia/Kolkata")).toEqual({
    start: "2031-03-10",
    endsAt: new Date("2031-03-16T18:30:00Z"),
    todayFrom: new Date("2031-03-09T18:30:00Z"),
  });
});

test("a Monday is its own week's first day", () => {
  const monday = new Date("2031-03-03T00:00:00Z");
  expect(leagueWeek(monday, "UTC").start).toBe("2031-03-03");
});

test("the time left is whole days and hours", () => {
  const now = new Date("2031-03-07T18:00:00Z");
  expect(timeLeft(now, new Date("2031-03-10T00:00:00Z"))).toEqual({
    days: 2,
    hours: 6,
  });
  expect(timeLeft(now, now)).toEqual({ days: 0, hours: 0 });
});

test("a member's week reads as the design's This week", () => {
  const row = { matches: 14, battles: 1, checkpoints: 0, today: 41 };
  expect(weekSoFar(row, false)).toBe("14 matches · 1 battle");
  expect(weekSoFar({ ...row, matches: 1, battles: 0 }, true)).toBe(
    "1 match · +41 today",
  );
  expect(weekSoFar({ ...row, checkpoints: 2, today: 0 }, true)).toBe(
    "14 matches · 1 battle · 2 checkpoints",
  );
  expect(
    weekSoFar({ matches: 0, battles: 0, checkpoints: 0, today: 0 }, false),
  ).toBe("");
});

test("tiers above and below, none past Diamond or Bronze", () => {
  expect(tierAbove("sapphire")).toBe("ruby");
  expect(tierBelow("sapphire")).toBe("gold");
  expect(tierAbove("diamond")).toBeNull();
  expect(tierBelow("bronze")).toBeNull();
});

// LOAD-5: a source is queued under its own key, so a repeat is the same job.
test("a source's points are queued once by key", async () => {
  const enqueue = vi.fn<JobQueue["enqueue"]>(() => Promise.resolve());
  await queueLeaguePoints({ enqueue }, "checkpoint", "42");
  expect(enqueue).toHaveBeenCalledWith(
    "league_points",
    { source_kind: "checkpoint", source_id: "42" },
    { idempotencyKey: "league-checkpoint-42" },
  );
  await queueLeaguePoints({ enqueue }, "hld_match", "m1");
  expect(enqueue).toHaveBeenLastCalledWith(
    "league_points",
    { source_kind: "hld_match", source_id: "m1" },
    { idempotencyKey: "league-hld-match-m1" },
  );
});
