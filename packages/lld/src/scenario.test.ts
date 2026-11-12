import { expect, test } from "vitest";
import { Interface } from "./interface";
import { counter } from "./fixtures.test-helpers";
import { checkScenario, ResultLine, Scenario } from "./scenario";

// P5-W29-S01 (LLDQ-1, EXEC-2): a scenario is the calls a harness makes, read on stdin;
// a result line is what one call returned, printed raw for the checker (EXEC-4).
const iface = Interface.parse(counter);
const scenario = {
  calls: [
    { method: "new", args: [3] },
    { method: "allow", args: ["ana", 1] },
    { method: "usage", args: [["ana", "bo"]] },
    { method: "reset", args: [] },
  ],
};

test("a scenario that fits its interface", () => {
  expect(checkScenario(iface, Scenario.parse(scenario))).toEqual([]);
});

test("the constructor first, known methods, the right number and kinds of args", () => {
  const first = { method: "new", args: [3] };
  const problems = (calls: object[]) =>
    checkScenario(iface, Scenario.parse({ calls }));
  expect(problems(scenario.calls.slice(1))[0]).toMatch(/first call/);
  expect(problems([first, { method: "nope", args: [] }])[0]).toMatch(
    /unknown method/,
  );
  expect(problems([first, { method: "allow", args: ["ana"] }])[0]).toMatch(
    /2 args/,
  );
  expect(problems([first, { method: "allow", args: ["ana", 1.5] }])[0]).toMatch(
    /call 1 arg 2.*int/,
  );
  expect(problems([first, { method: "usage", args: [["ana", 2]] }])[0]).toMatch(
    /list<string>/,
  );
  expect(
    problems([
      { method: "new", args: [3] },
      { method: "new", args: [3] },
    ])[0],
  ).toMatch(/only the first/);
});

test("a result line holds a value or an error, never both", () => {
  expect(ResultLine.safeParse({ call: 0, value: null }).success).toBe(true);
  expect(ResultLine.safeParse({ call: 2, value: { ana: 1 } }).success).toBe(
    true,
  );
  expect(ResultLine.safeParse({ call: 1, error: "IndexError" }).success).toBe(
    true,
  );
  expect(ResultLine.safeParse({ call: 1 }).success).toBe(false);
  expect(ResultLine.safeParse({ call: 1, value: 1, error: "x" }).success).toBe(
    false,
  );
  expect(ResultLine.safeParse({ call: -1, value: 1 }).success).toBe(false);
  expect(ResultLine.safeParse({ call: 1, value: 1, x: 1 }).success).toBe(false);
  expect(
    ResultLine.safeParse({ call: 1, error: "x".repeat(201) }).success,
  ).toBe(false);
  expect(ResultLine.safeParse({ call: 1, error: "é" }).success).toBe(false);
});

// P5-W30-S02b (LLDQ-3, §6.5): threads after some calls, each fitting the interface.
test("threads start after the constructor, within the calls, and never construct", () => {
  const allow = { method: "allow", args: ["ana", 1] };
  const problems = (concurrent: object) =>
    checkScenario(iface, Scenario.parse({ ...scenario, concurrent }));
  const parses = (concurrent: object) =>
    Scenario.safeParse({ ...scenario, concurrent }).success;
  expect(problems({ after: 1, threads: [[allow], [allow]] })).toEqual([]);
  expect(problems({ after: 3, threads: [[allow], [allow]] })).toEqual([]);
  // Threads with no call after them would be judged on nothing.
  expect(problems({ after: 4, threads: [[allow], [allow]] })[0]).toMatch(
    /no call follows/,
  );
  expect(
    problems({
      after: 1,
      threads: [[allow], [{ method: "new", args: [3] }]],
    })[0],
  ).toMatch(/thread 1 call 0: "new"/);
  expect(
    problems({
      after: 1,
      threads: [[allow], [{ method: "allow", args: [] }]],
    })[0],
  ).toMatch(/thread 1 call 0: allow takes 2/);
  expect(parses({ after: 0, threads: [[allow], [allow]] })).toBe(false);
  expect(parses({ after: 1, threads: [[allow]] })).toBe(false);
  expect(
    parses({ after: 1, threads: Array.from({ length: 9 }, () => [allow]) }),
  ).toBe(false);
  expect(parses({ after: 1, threads: [[allow], []] })).toBe(false);
});
