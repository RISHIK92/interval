import { expect, test } from "vitest";
import { greeting, linesFor, type GreetingContext } from "./greetings";

const base: GreetingContext = {
  hour: 9,
  weekday: 2, // Tuesday
  firstName: "Ada",
  chip: "3-8",
  continuing: null,
};

test("a line fits the hour: no morning lines at 2 a.m.", () => {
  const night = linesFor({ ...base, hour: 2 });
  expect(night.length).toBeGreaterThan(0);
  expect(night.some((line) => /morning/i.test(line))).toBe(false);
  expect(linesFor(base).some((line) => /morning/i.test(line))).toBe(true);
});

test("the same day and part of day keep the same line", () => {
  expect(greeting(base, "2026-10-26")).toBe(greeting(base, "2026-10-26"));
  expect(greeting({ ...base, hour: 10 }, "2026-10-26")).toBe(
    greeting(base, "2026-10-26"),
  );
});

test("without a name, no line says undefined or leaves a stray comma", () => {
  for (let hour = 0; hour < 24; hour += 1) {
    for (const line of linesFor({ ...base, hour, firstName: null })) {
      expect(line).not.toMatch(/undefined|null|, \.|,\s*$|\s{2}/);
    }
  }
});

test("something left unfinished can be the line, by its title", () => {
  expect(linesFor({ ...base, continuing: "Raft in one page" })).toContain(
    "You left “Raft in one page” on read.",
  );
});

test("the chip and the weekday have their own lines", () => {
  expect(linesFor({ ...base, chip: "1-3" }).join(" ")).toMatch(/speedrun/i);
  expect(linesFor({ ...base, weekday: 5 }).join(" ")).toMatch(/friday/i);
  expect(linesFor(base).join(" ")).not.toMatch(/friday/i);
});
