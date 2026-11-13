import type { BattleState } from "@interval/game-client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { BattleView, codeFor, outsidePaste } from "./BattlePlay";
import { type CodeEditorProps, removedBy } from "./CodeEditor";

// P5-W31-S03 (§6.5; Q-P5-15, Q-P5-16; LLDQ-4): the battle's screen for each state.
function Editor({ language, value }: CodeEditorProps) {
  return <textarea aria-label={language} defaultValue={value} />;
}

const show = (state: BattleState, failed = false) =>
  renderToStaticMarkup(
    <BattleView
      state={state}
      failed={failed}
      statement="# LRU cache"
      examples={['[{"method":"new","args":[2]}]']}
      languages={["python", "go"]}
      language="python"
      code="class LRUCache: ..."
      now={1_000}
      Editor={Editor}
      onLanguage={() => undefined}
      onCode={() => undefined}
      onPaste={() => undefined}
      onSend={() => undefined}
    />,
  );

const playing: BattleState = {
  phase: "playing",
  you: "ada",
  endsAt: 1_000 + 30 * 60_000 + 5_000,
  extension: null,
  best: { ada: 700, bob: 300 },
  ran: null,
  submitted: null,
  running: false,
  submitting: false,
  notice: null,
};

test("connecting: the problem and the code are there, the buttons wait", () => {
  const html = show({ phase: "connecting", you: null });
  expect(html).toContain("# LRU cache");
  expect(html).toContain("[{&quot;method&quot;:&quot;new&quot;");
  expect(html).toContain("class LRUCache: ...");
  expect(html).toContain("Connecting");
  expect(html.match(/disabled=""/g)).toHaveLength(2);
});

test("playing: the clock, both bests, and no extension before the reveal", () => {
  const html = show(playing);
  expect(html).toContain("30:05");
  expect(html).toContain("You 700 · Opponent 300");
  expect(html).not.toContain("Extension");
  expect(html.match(/disabled=""/g)).toBeNull();
});

test("a Run shows each visible test; a Submit only counts per layer", () => {
  const html = show({
    ...playing,
    running: true,
    ran: [
      { passed: true, verdict: "ok" },
      { passed: false, verdict: "ok", call: 3, reason: "wrong value" },
      { passed: false, verdict: "compile_error" },
    ],
    submitted: {
      points: 700,
      layers: {
        visible: { passed: 2, total: 2 },
        hidden: { passed: 9, total: 10 },
      },
    },
    notice: "wait 20 s",
  });
  expect(html).toContain("Running…");
  expect(html).toContain("Test 2: failed at call 3: wrong value");
  expect(html).toContain("Test 3: failed (compile error)");
  expect(html).toContain("Submission: 700 points");
  expect(html).toContain("Hidden: 9 of 10");
  expect(html).toContain("wait 20 s");
});

test("after the reveal, the extension and its new methods in the player's language", () => {
  const html = show({
    ...playing,
    extension: {
      statement: "# Resizing",
      starters: { python: "def resize(self, capacity)", go: "func" },
    },
  });
  expect(html).toContain("# Resizing");
  expect(html).toContain("def resize(self, capacity)");
});

test("the end: the outcome and points; a lost connection says how to rejoin", () => {
  const html = show({
    phase: "final",
    you: "ada",
    outcome: "won",
    totals: { ada: 1000, bob: 300 },
    abandoned: ["bob"],
  });
  expect(html).toContain("You won.");
  expect(html).toContain("Opponent: 300 points (abandoned)");
  expect(show(playing, true)).toContain("Reload to rejoin");
});

test("each battle and language keeps its own code; the starter until there's some", () => {
  const saved = new Map([
    ["battle:m1:python", "class Cache: ..."],
    ["battle:m2:go", "type Cache struct{}"],
  ]);
  const read = (key: string) => saved.get(key) ?? null;
  const starters = { python: "class Cache:", go: "type Cache" };
  expect(codeFor(read, "m1", starters, "python")).toBe("class Cache: ...");
  expect(codeFor(read, "m1", starters, "go")).toBe("type Cache");
  expect(codeFor(read, "m2", starters, "go")).toBe("type Cache struct{}");
  expect(codeFor(read, "m2", starters, "java")).toBe("");
});

// P5-W31-S04a (Q-P5-17): only a long paste from outside the page and the player's code.
test("a paste counts when it's 200+ characters and not already the player's", () => {
  const long = "x".repeat(150) + "\n" + "y".repeat(60);
  expect(outsidePaste(long, ["class Cache:"])).toBe(211);
  expect(outsidePaste(`  ${long}\n`, [])).toBe(211);
  expect(outsidePaste("z".repeat(199), [])).toBeNull();
  expect(outsidePaste(long, [`before ${long} after`])).toBeNull();
  expect(outsidePaste(long, ["", `def grow(self):\n${long}`])).toBeNull();
});

test("text cut from the editor and pasted back is the player's own", () => {
  const block = "def get(self, key):\n" + "    pass\n".repeat(30);
  const before = `class Cache:\n${block}`;
  const cut = removedBy(before, [
    { rangeOffset: 13, rangeLength: block.length },
    { rangeOffset: 0, rangeLength: 0 }, // a plain insert removes nothing
  ]);
  expect(cut).toEqual([block]);
  expect(outsidePaste(block, ["class Cache:\n", ...cut])).toBeNull();
});
