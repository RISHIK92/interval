import type { BattleState } from "@interval/game-client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import {
  BattleView,
  codeFor,
  initials,
  names,
  outsidePaste,
} from "./BattlePlay";
import { type CodeEditorProps, removedBy } from "./CodeEditor";

// P5-W31-S03 (§6.5; Q-P5-15, Q-P5-16; LLDQ-4): the battle's screen for each state.
function Editor({ language, value }: CodeEditorProps) {
  return <textarea aria-label={language} defaultValue={value} />;
}

const show = (
  state: BattleState,
  failed = false,
  practice?: Parameters<typeof BattleView>[0]["practice"],
  players: Record<string, string> = {},
) =>
  renderToStaticMarkup(
    <BattleView
      practice={practice}
      players={players}
      resultHref="/play/battle/m1/result"
      heading={<h1>LRU cache</h1>}
      about="An LLD battle, about 45 minutes."
      signatures={["LRUCache(capacity)", "put(key, value, ttl) → int"]}
      state={state}
      failed={failed}
      statement={"# LRU cache\n\nKeep the most recent."}
      examples={["LRUCache(2)\nput(1, 1)\nget(1) → 1"]}
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
  practice: false,
  extension: null,
  best: { ada: 700, bob: 300 },
  progress: { ada: { passed: 9, total: 14 }, bob: { passed: 4, total: 14 } },
  hints: null,
  ran: null,
  submitted: null,
  failing: null,
  running: false,
  submitting: false,
  notice: null,
};

test("connecting: the problem and the code are there, the buttons wait", () => {
  const html = show({ phase: "connecting", you: null });
  // The statement drawn without its title (the page's heading has it).
  expect(html).toContain("Keep the most recent.");
  expect(html).not.toContain("# LRU cache");
  expect(html).toContain("get(1) → 1");
  expect(html).toContain("class LRUCache: ...");
  expect(html).toContain("Connecting");
  expect(html.match(/disabled=""/g)).toHaveLength(2);
});

test("playing: the clock, both bests, and no extension before the reveal", () => {
  const html = show(playing, false, undefined, { bob: "Robin Sharma" });
  expect(html).toContain("30:05");
  // Q-WD-14: yours in points, the opponent's as tests passed, by their initials.
  expect(html).toContain(">Your best · 700 points<");
  expect(html).toContain(">RS · 4 of 14 tests<");
  expect(html).toContain('title="Robin Sharma: 4 of 14 tests"');
  expect(html).not.toContain("300");
  expect(html).not.toContain("Extension");
  expect(html.match(/disabled=""/g)).toBeNull();
});

test("the run button says Run on a phone and Run tests on a desktop", () => {
  const html = show(playing);
  const button = /<button[^>]*>(Run.*?)<\/button>/.exec(html)?.[1];
  // A phone hides the desktop's longer label, so its name stays the plain "Run".
  expect(button).toBe('Run<span class="hidden lg:inline"> tests</span>');
});

test("a Run shows each visible test; a Submit only counts per layer", () => {
  const html = show({
    ...playing,
    running: true,
    ran: [
      { passed: true, verdict: "ok" },
      { passed: false, verdict: "ok", call: 3, reason: "wrong value" },
      { passed: false, verdict: "compile_error" },
      { passed: false, verdict: "compile_time_limit" },
      { passed: false, verdict: "time_limit" },
    ],
    submitted: {
      points: 700,
      layers: {
        concurrency: { passed: 0, total: 5 },
        hidden: { passed: 9, total: 10 },
        visible: { passed: 2, total: 2 },
      },
      failures: [],
    },
    notice: "wait 20 s",
  });
  expect(html).toContain("Running…");
  expect(html).toContain("Test 2: failed at call 3: wrong value");
  expect(html).toContain("Test 3: failed (compile error)");
  // A slow compile says so, never "time limit", which is the program's own.
  expect(html).toContain("Test 4: failed (your code took too long to compile)");
  expect(html).toContain("Test 5: failed (time limit)");
  expect(html).toContain("Submission: 700 points");
  // On a desktop each layer is a row of the Tests column: its name, then its count.
  expect(html).toMatch(/Hidden<span[^>]*>: <\/span><\/span><span[^>]*>9 of 10/);
  expect(html).toContain("wait 20 s");
  // The layers in the order they're played, whatever order they came in.
  const rows = [...html.matchAll(/(Visible|Hidden|Concurrency)<span/g)].map(
    (m) => m[1],
  );
  expect(rows).toEqual(["Visible", "Hidden", "Concurrency"]);
});

test("the battle's brief is a note in the Tests column, not the header", () => {
  const html = show(playing);
  const header = /<header[\s\S]*?<\/header>/.exec(html)?.[0] ?? "";
  const tests = /aria-label="Tests"[\s\S]*$/.exec(html)?.[0] ?? "";
  expect(header).not.toContain("An LLD battle");
  expect(tests).toContain("An LLD battle, about 45 minutes.");
});

test("a long signature wraps only after its commas", () => {
  const html = show(playing);
  // Each call is a line; its parameters are unbreakable pieces with a space between.
  expect(html).toContain(
    '<span class="whitespace-pre">put(key,</span> <span class="whitespace-pre">value,</span> <span class="whitespace-pre">ttl) → int</span>',
  );
});

test("after the reveal, the extension and its new methods in the player's language", () => {
  const html = show({
    ...playing,
    extension: {
      statement: "# Resizing",
      starters: { python: "def resize(self, capacity)", go: "func" },
    },
  });
  // The statement's Markdown is drawn, not printed: the heading without its "#".
  expect(html).toContain("Resizing");
  expect(html).not.toContain("# Resizing");
  expect(html).toContain("def resize(self, capacity)");
});

test("the end: the outcome and points; a lost connection says how to rejoin", () => {
  const html = show({
    phase: "final",
    you: "ada",
    outcome: "won",
    totals: { ada: 1000, bob: 300 },
    abandoned: ["bob"],
    places: { ada: 1, bob: 2 },
  });
  expect(html).toContain("You won.");
  expect(html).toContain('href="/play/battle/m1/result"');
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

// P5-W32 (C-03, Q-P5-19): rooms number their opponents; a room's end names your place;
// alone, the reference pace.
test("a room has a compact pill per opponent; a name unknown is numbered", () => {
  const html = show(
    {
      ...playing,
      best: { ada: 700, bob: 300, cy: 0 },
      progress: {
        ada: { passed: 9, total: 14 },
        bob: { passed: 4, total: 14 },
        cy: { passed: 0, total: 14 },
      },
    },
    false,
    undefined,
    { bob: "robin_s" },
  );
  expect(html).toContain(">RS · 4/14<");
  expect(html).toContain(">Opponent 2 · 0/14<");
  expect(html).toContain(">Your best · 700 points<");
});

test("initials: two words' first letters, or one word's first two", () => {
  expect(initials("Robin Sharma")).toBe("RS");
  expect(initials("robin_s")).toBe("RS");
  expect(initials("ada")).toBe("AD");
  expect(initials("  ")).toBe("");
});

test("a room numbers the opponents; a 1v1 has the opponent", () => {
  expect(names(["a", "b", "c"], "b")).toEqual({
    a: "Opponent 1",
    b: "You",
    c: "Opponent 2",
  });
  expect(names(["a", "b"], "a")).toEqual({ a: "You", b: "Opponent" });
});

test("a room's end names your place; a solo one the points; alone, the pace", () => {
  const room = show({
    phase: "final",
    you: "b",
    outcome: "lost",
    totals: { a: 1000, b: 700, c: 400 },
    abandoned: [],
    places: { a: 1, b: 2, c: 3 },
  });
  expect(room).toContain("You placed 2 of 3.");
  expect(room).toContain("Opponent 2: 400 points");
  const solo = show({
    phase: "final",
    you: "a",
    outcome: "won",
    totals: { a: 700 },
    abandoned: [],
    places: { a: 1 },
  });
  expect(solo).toContain("Finished.");
  expect(show({ ...playing, best: { ada: 0 } })).toContain("Reference pace");
  expect(show(playing)).not.toContain("Reference pace");
});

// P5-W33 (Q-P5-13): the interviewer's answers are labelled AI; the 10th question ends
// the asking.
test("the interviewer labels its answers AI and stops at 10", async () => {
  const { InterviewerView } = await import("./Interviewer");
  const q = (n: number, status: "pending" | "answered" | "unavailable") => ({
    id: String(n),
    question: `Q${String(n)}?`,
    status,
    answer: status === "answered" ? `A${String(n)}.` : null,
  });
  const html = renderToStaticMarkup(
    <InterviewerView
      asked={[q(1, "answered"), q(2, "pending"), q(3, "unavailable")]}
      draft=""
      notice={null}
      onDraft={() => undefined}
      onAsk={() => undefined}
    />,
  );
  expect(html).toContain(">AI</span>A1.");
  expect(html).toContain("Thinking…");
  expect(html).toContain("couldn&#x27;t answer that one");
  expect(html).toContain("7 of 10 questions left");
  const full = renderToStaticMarkup(
    <InterviewerView
      asked={Array.from({ length: 10 }, (_, i) => q(i, "answered"))}
      draft=""
      notice={null}
      onDraft={() => undefined}
      onAsk={() => undefined}
    />,
  );
  expect(full).not.toContain("Your question");
});

// ADR-0048 (Q-WD-28): practice is the battle screen with no clock and no opponent, the
// player's best, and the extension on request.
const practicing = {
  ...playing,
  practice: true,
  best: { ada: 0 },
};
const practiceView = {
  best: { points: 820, hidden: { passed: 9, total: 10 } },
  canReveal: true,
  onReveal: () => undefined,
  saving: null,
};

test("practice: no clock, no opponent, the best, and a reveal button", () => {
  const html = show(practicing, false, practiceView);
  expect(html).not.toContain('role="timer"');
  expect(html).not.toContain("Opponent");
  expect(html).not.toContain("Reference pace");
  expect(html).toContain("LLD practice");
  expect(html).toContain("Your best: 820 · hidden 9/10");
  expect(html).toMatch(/<button[^>]*>Reveal the extension<\/button>/);
  // Revealed, or a problem without an extension: no button.
  expect(
    show(practicing, false, { ...practiceView, canReveal: false }),
  ).not.toContain("Reveal the extension");
  expect(
    show(
      {
        ...practicing,
        extension: { statement: "# Resizing", starters: { python: "def r()" } },
      },
      false,
      practiceView,
    ),
  ).not.toContain("Reveal the extension");
  // Nothing judged yet: not started.
  expect(show(practicing, false, { ...practiceView, best: null })).toContain(
    "Not started",
  );
});

test("practice: a session that ended says a new one is starting, not a result", () => {
  const html = show(
    {
      phase: "final",
      you: "ada",
      outcome: "won",
      totals: { ada: 700 },
      abandoned: [],
      places: { ada: 1 },
    },
    false,
    practiceView,
  );
  expect(html).toContain("Starting a new session");
  expect(html).not.toContain("See the results");
});

test("practice: an autosave that couldn't save says why", () => {
  expect(
    show(practicing, false, {
      ...practiceView,
      saving: "Saved in another tab: reload to get it.",
    }),
  ).toContain("Saved in another tab: reload to get it.");
});

// The design's frame: a way out in the header, and where the code is kept.
test("the header leaves to the lobby; the editor says where the code is kept", () => {
  const html = show(playing);
  expect(html).toMatch(
    /<a href="\/play\/battle" aria-label="Leave the battle"/,
  );
  // Q-WD-17: a battle's code is autosaved on the server too.
  expect(html).toContain("Autosaved");
  expect(html).not.toContain("Saved in this tab");
  expect(show(practicing, false, practiceView)).toContain("Autosaved");
  expect(html).toMatch(/aria-keyshortcuts="Control\+Enter Meta\+Enter"/);
});

// Q-WD-17: the hints' rows in the problem column, and the opened ones; none offered, none
// shown.
test("hints: offered in the problem column when the battle has them", () => {
  expect(show(playing)).not.toContain("Stuck?");
  const html = show({
    ...playing,
    hints: {
      costs: [10, 30, 60],
      opened: [{ level: 1, text: "Think about recency." }],
      spent: 10,
    },
  });
  const problem = /aria-label="Problem"[\s\S]*?aria-label="Your code"/.exec(
    html,
  )?.[0];
  expect(problem).toContain("Stuck? Hints cost points");
  expect(problem).toContain("Think about recency.");
  expect(problem).toContain("Hints: −10");
});

// Q-WD-17 (owner, 2026-11-24): a hint taken is public: the opponent's pill says which
// levels, never the text.
test("an opponent's pill shows the hints they used", () => {
  const one = show(
    {
      ...playing,
      progress: {
        ada: { passed: 9, total: 14, hints: [] },
        bob: { passed: 4, total: 14, hints: [2] },
      },
    },
    false,
    undefined,
    { bob: "Robin Sharma" },
  );
  expect(one).toContain("RS · 4 of 14 tests");
  expect(one).toContain(">Hint 2<");
  expect(one).toContain("Robin Sharma used hints: approach");
  const two = show(
    {
      ...playing,
      progress: {
        ada: { passed: 9, total: 14, hints: [1] },
        bob: { passed: 4, total: 14, hints: [1, 2] },
      },
    },
    false,
    undefined,
    { bob: "rsharma" },
  );
  expect(two).toContain(">Hints 1, 2<");
  expect(two).toContain("rsharma used hints: nudge, approach");
  // Your own hints are in your problem column, not your pill.
  expect(two).toContain(">Your best · 700 points<");
});

// Q-WD-17 (LLDQ-4): the failing visible test's name, its message, and a link to the line.
test("a failing visible test shows its name, message and Jump to line", () => {
  const html = show({
    ...playing,
    ran: [{ passed: false, verdict: "ok", name: "Test 1" }],
    failing: {
      name: "Test 1",
      message: "call 2 (park): expected 1, got KeyError: 'x'",
      line: 14,
    },
  });
  expect(html).toMatch(/aria-label="Failing test"/);
  expect(html).toContain("Test 1");
  expect(html).toContain(
    "call 2 (park): expected 1, got KeyError: &#x27;x&#x27;",
  );
  expect(html).toMatch(
    /<button[^>]*type="button"[^>]*>Jump to line 14<\/button>/,
  );
  // No line (a wrong value, or C++): the name and message only.
  const none = show({
    ...playing,
    failing: { name: "Test 1", message: "call 1 (get): expected 1, got 2" },
  });
  expect(none).toContain("call 1 (get): expected 1, got 2");
  expect(none).not.toContain("Jump to line");
  expect(show(playing)).not.toContain("Failing test");
});
