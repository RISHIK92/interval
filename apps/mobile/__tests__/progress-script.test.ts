import type { Marker } from "@interval/api-client";
import { progressScript } from "../lib/progress-script";

// Node's own vm (the app has no Node types): a fresh global for the page script.
const { runInNewContext } = jest.requireActual<{
  runInNewContext: (code: string, context: object) => unknown;
}>("node:vm");

// P4-W20-S03 (§5D): the script the reader injects only scrolls and measures. It runs here
// against a page whose every object throws on a write or a mutating call, so any change
// to the publisher's page fails the test.
const MUTATORS = new Set([
  "appendChild",
  "removeChild",
  "replaceChild",
  "insertBefore",
  "insertAdjacentHTML",
  "insertAdjacentElement",
  "insertAdjacentText",
  "setAttribute",
  "removeAttribute",
  "toggleAttribute",
  "remove",
  "append",
  "prepend",
  "replaceWith",
  "after",
  "before",
  "write",
  "writeln",
  "createElement",
  "attachShadow",
  "focus",
]);
const frozen = <T extends object>(target: T, name: string): T =>
  new Proxy(target, {
    set: (_, key) => {
      throw new Error(`${name}.${String(key)} was written`);
    },
    defineProperty: (_, key) => {
      throw new Error(`${name}.${String(key)} was defined`);
    },
    deleteProperty: (_, key) => {
      throw new Error(`${name}.${String(key)} was deleted`);
    },
    get: (object, key) => {
      if (typeof key === "string" && MUTATORS.has(key))
        throw new Error(`${name}.${key} was called`);
      return Reflect.get(object, key) as unknown;
    },
  });

type Fake = { id: string; text: string; top: number; scrolled: number };
const PAGE = "https://blog.dev/raft?utm_source=interval#raft";
function page(
  elements: Fake[],
  height: number,
  at = "https://blog.dev/raft/#raft",
) {
  const posted: unknown[] = [];
  let onScroll: () => void = () => undefined;
  const state = { scrollY: 0 };
  const element = (fake: Fake) =>
    frozen(
      {
        textContent: fake.text,
        getBoundingClientRect: () => ({ top: fake.top - state.scrollY }),
        scrollIntoView: () => {
          fake.scrolled += 1;
        },
      },
      `#${fake.id}`,
    );
  const nodes = elements.map(element);
  const window = frozen(
    {
      get scrollY() {
        return state.scrollY;
      },
      innerHeight: 800,
      location: frozen({ href: at }, "location"),
      addEventListener: (type: string, listener: () => void) => {
        if (type === "scroll") onScroll = listener;
      },
      ReactNativeWebView: frozen(
        {
          postMessage: (message: string) => {
            posted.push(JSON.parse(message));
          },
        },
        "ReactNativeWebView",
      ),
    },
    "window",
  );
  const document = frozen(
    {
      getElementById: (id: string) => {
        const at = elements.findIndex((e) => e.id === id);
        return at === -1 ? null : nodes[at];
      },
      querySelectorAll: () => nodes,
      documentElement: frozen({ scrollHeight: height }, "documentElement"),
    },
    "document",
  );
  return {
    posted,
    scrollTo: (y: number) => {
      state.scrollY = y;
      onScroll();
    },
    run: (start: Marker, end: Marker | null) =>
      runInNewContext(progressScript(PAGE, start, end), {
        window,
        document,
        location: window.location,
        URL,
      }),
  };
}

const raft = (): Fake => ({
  id: "raft",
  text: " Raft\n",
  top: 1000,
  scrolled: 0,
});
const paxos = (): Fake => ({
  id: "paxos",
  text: "Paxos",
  top: 3000,
  scrolled: 0,
});

test("by id: scrolls to the start and reports the furthest point, never writing", () => {
  const start = raft();
  const p = page([start, paxos()], 5000);
  expect(p.run({ id: "raft" }, { id: "paxos" })).toBe(true);
  expect(start.scrolled).toBe(1);
  // The screen's bottom (scrollY + 800) from 1000 to 3000.
  p.scrollTo(1200); // 1000 of 2000
  p.scrollTo(600); // back up: no new report
  p.scrollTo(2000); // 1800 of 2000
  p.scrollTo(4000); // past the end: 1
  expect(p.posted).toEqual([
    { type: "progress", value: 0 },
    { type: "progress", value: 0.5 },
    { type: "progress", value: 0.9 },
    { type: "progress", value: 1 },
  ]);
});

test("by a heading's text; the last section runs to the page's end", () => {
  const p = page([raft()], 3000);
  p.run({ text: "Raft" }, null);
  p.scrollTo(2200); // 3000 - 1000 = 2000 to read; 2000 of it
  expect(p.posted.at(-1)).toEqual({ type: "progress", value: 1 });
});

test.each([
  ["no start", { id: "missing" }, { id: "paxos" }],
  ["no end", { id: "raft" }, { text: "Missing" }],
])("%s: unmeasurable, said once", (_, start: Marker, end: Marker) => {
  const p = page([raft(), paxos()], 5000);
  p.run(start, end);
  p.scrollTo(2000);
  expect(p.posted).toEqual([{ type: "unmeasurable" }]);
});

test("the markers are data, never code", () => {
  const p = page([raft()], 3000);
  p.run({ text: '"); throw new Error("ran"); ("' }, null);
  expect(p.posted).toEqual([{ type: "unmeasurable" }]);
});

test("a heading with a line separator still parses", () => {
  const p = page([{ ...raft(), text: "Raft\u2028log" }], 3000);
  p.run({ text: "Raft\u2028log" }, null);
  expect(p.posted[0]).toEqual({ type: "progress", value: 0 });
});

test("a page a link led to isn't measured", () => {
  const p = page([raft(), paxos()], 5000, "https://blog.dev/other#raft");
  p.run({ id: "raft" }, { id: "paxos" });
  p.scrollTo(2000);
  expect(p.posted).toEqual([]);
});

test("an end above the start: unmeasurable, said once", () => {
  const p = page([raft(), { ...paxos(), top: 500 }], 5000);
  p.run({ id: "raft" }, { id: "paxos" });
  p.scrollTo(2000);
  expect(p.posted).toEqual([{ type: "unmeasurable" }]);
});

test("a section shorter than the screen is read through once in view", () => {
  const p = page([raft(), { ...paxos(), top: 1300 }], 5000);
  p.run({ id: "raft" }, { id: "paxos" });
  p.scrollTo(600); // the screen's bottom at 1400, past 1300
  expect(p.posted.at(-1)).toEqual({ type: "progress", value: 1 });
});

test("a heading's permalink glyph doesn't stop the match", () => {
  const p = page([{ ...raft(), text: "Raft ¶" }], 3000);
  p.run({ text: "Raft" }, null);
  expect(p.posted[0]).toEqual({ type: "progress", value: 0 });
});
