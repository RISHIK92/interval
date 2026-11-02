import { expect, test } from "vitest";
import { boardName, guestLabel } from "./boards";

// P3-W14-S06: board names as P3-W14-S01's SQL makes them (UTC days, ISO weeks in UTC).
test.each([
  ["daily", "current", "2026-11-02T23:59:59Z", "daily:2026-11-02"],
  ["daily", "previous", "2026-11-02T00:00:00Z", "daily:2026-11-01"],
  ["daily", "previous", "2027-01-01T05:00:00Z", "daily:2026-12-31"],
  ["sprint", "current", "2026-11-08T23:59:59Z", "sprint:2026-W45"],
  ["sprint", "current", "2026-11-09T00:00:00Z", "sprint:2026-W46"],
  ["estimation", "previous", "2026-11-09T00:00:00Z", "estimation:2026-W45"],
  // A Friday in 2026's week 53, and 2027's first Monday.
  ["sprint", "current", "2027-01-01T12:00:00Z", "sprint:2026-W53"],
  ["sprint", "current", "2027-01-04T00:00:00Z", "sprint:2027-W01"],
  ["sprint", "previous", "2027-01-04T00:00:00Z", "sprint:2026-W53"],
  // 2021-01-03 is a Sunday in 2020's week 53.
  ["estimation", "current", "2021-01-03T10:00:00Z", "estimation:2020-W53"],
  ["sprint", "current", "2025-12-29T00:00:00Z", "sprint:2026-W01"],
] as const)("%s %s at %s is %s", (game, period, at, name) => {
  expect(boardName(game, period, new Date(at))).toBe(name);
});

test("a guest's label is stable, four digits, and differs between guests", () => {
  const a = guestLabel("guest-a");
  expect(a).toMatch(/^Guest \d{4}$/);
  expect(guestLabel("guest-a")).toBe(a);
  const labels = new Set(
    Array.from({ length: 50 }, (_, i) => guestLabel(`guest-${String(i)}`)),
  );
  expect(labels.size).toBeGreaterThan(45);
});
