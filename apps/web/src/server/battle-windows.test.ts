import { expect, test } from "vitest";
import { group, remindAt, windowStatus, windowsFrom } from "./battle-windows";

// P5-W32 (Q-P5-12, Q-P5-19): the windows' schedule, registration and grouping.

test("nightly at 21:00 local, plus 11:00 at weekends, from the live one on", () => {
  // Friday 2026-11-13, 21:20 in Kolkata (UTC+5:30): the night's window is live.
  const now = new Date("2026-11-13T15:50:00Z");
  const [live, next, after] = windowsFrom(now, "Asia/Kolkata");
  expect(live?.toISOString()).toBe("2026-11-13T15:30:00.000Z");
  expect(next?.toISOString()).toBe("2026-11-14T05:30:00.000Z"); // Saturday 11:00
  expect(after?.toISOString()).toBe("2026-11-14T15:30:00.000Z");
  // Once it's over, the next one is first.
  expect(
    windowsFrom(
      new Date("2026-11-13T16:15:00Z"),
      "Asia/Kolkata",
    )[0]?.toISOString(),
  ).toBe("2026-11-14T05:30:00.000Z");
});

test("a window keeps its local hour across a daylight-saving change", () => {
  // London leaves summer time on Sunday 2026-10-25.
  const windows = windowsFrom(
    new Date("2026-10-24T12:00:00Z"),
    "Europe/London",
  );
  expect(windows.slice(0, 3).map((w) => w.toISOString())).toEqual([
    "2026-10-24T20:00:00.000Z", // Saturday 21:00 BST
    "2026-10-25T11:00:00.000Z", // Sunday 11:00 GMT
    "2026-10-25T21:00:00.000Z",
  ]);
});

test("registration closes 5 minutes before; the reminder is 15 minutes before", () => {
  const at = new Date("2026-11-13T15:30:00Z");
  expect(windowStatus(at, new Date("2026-11-13T15:24:59Z"))).toBe("open");
  expect(windowStatus(at, new Date("2026-11-13T15:25:00Z"))).toBe("closed");
  expect(windowStatus(at, new Date("2026-11-13T15:30:00Z"))).toBe("live");
  expect(remindAt(at).toISOString()).toBe("2026-11-13T15:15:00.000Z");
});

test("rooms of 4, then 3 or 2; one left over is alone", () => {
  expect(group([1, 2, 3, 4, 5, 6, 7])).toEqual([
    [1, 2, 3, 4],
    [5, 6, 7],
  ]);
  expect(group([1, 2, 3, 4, 5, 6])).toEqual([
    [1, 2, 3, 4],
    [5, 6],
  ]);
  expect(group([1, 2, 3, 4, 5])).toEqual([[1, 2, 3, 4], [5]]);
  expect(group([])).toEqual([]);
});
