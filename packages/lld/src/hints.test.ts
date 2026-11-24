import { expect, test } from "vitest";
import { HINT_LEVELS, parseHints } from "./hints";

// Q-WD-17 (owner, 2026-11-23): a problem's hints, hand-written in hints.md: a nudge, an
// approach and a code sketch, in that order.
const whole = [
  "> PROVISIONAL: for the owner's review.",
  "",
  "## Nudge",
  "",
  "Think about what you look up most.",
  "",
  "## Approach",
  "",
  "A hash map to a doubly linked list.",
  "On two lines.",
  "",
  "## Code sketch",
  "",
  "```text",
  "get(key):",
  "    node = map[key]",
  "",
  "    move node to front",
  "```",
  "",
].join("\n");

test("hints.md gives its three levels, the sketch without its fence", () => {
  expect(parseHints(whole)).toEqual([
    "Think about what you look up most.",
    "A hash map to a doubly linked list.\nOn two lines.",
    "get(key):\n    node = map[key]\n\n    move node to front",
  ]);
  expect(HINT_LEVELS).toEqual(["Nudge", "Approach", "Code sketch"]);
});

test("a level missing, out of order, empty or extra is refused", () => {
  const without = (heading: string) =>
    whole.replace(`## ${heading}`, "## Something else");
  expect(() => parseHints(without("Approach"))).toThrow(/Approach/);
  expect(() =>
    parseHints(whole.replace("Think about what you look up most.", "")),
  ).toThrow(/Nudge.*empty/);
  expect(() => parseHints(`${whole}\n## More\n\nx\n`)).toThrow(/three/);
  expect(() =>
    parseHints(
      whole
        .replace("## Nudge", "## Tmp")
        .replace("## Approach", "## Nudge")
        .replace("## Tmp", "## Approach"),
    ),
  ).toThrow();
  expect(() => parseHints(whole.replace("```text\n", ""))).toThrow(/fenced/);
});
