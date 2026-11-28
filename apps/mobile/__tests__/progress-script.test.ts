import { progressScript } from "../lib/progress-script";

// Node's own vm (the app has no Node types): a fresh global for the page script.
const { runInNewContext } = jest.requireActual<{
  runInNewContext: (code: string, context: object) => unknown;
}>("node:vm");

// P4-W20-S03 (§5D): the script the reader injects only measures (ADR-0058: the whole
// article's page). It runs here
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

const PAGE = "https://blog.dev/raft?utm_source=interval";
function page(height: number, at = "https://blog.dev/raft/") {
  const posted: unknown[] = [];
  let onScroll: () => void = () => undefined;
  const state = { scrollY: 0 };
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
    { documentElement: frozen({ scrollHeight: height }, "documentElement") },
    "document",
  );
  return {
    posted,
    scrollTo: (y: number) => {
      state.scrollY = y;
      onScroll();
    },
    run: (url = PAGE) =>
      runInNewContext(progressScript(url), {
        window,
        document,
        location: window.location,
        URL,
      }),
  };
}

test("reports the furthest point down the page, never writing", () => {
  const p = page(4000);
  expect(p.run()).toBe(true);
  // The screen's bottom (scrollY + 800) of the page's 4000.
  p.scrollTo(1200); // 2000 of 4000
  p.scrollTo(600); // back up: no new report
  p.scrollTo(2800); // 3600 of 4000
  p.scrollTo(4000); // past the end: 1
  expect(p.posted).toEqual([
    { type: "progress", value: 0.2 },
    { type: "progress", value: 0.5 },
    { type: "progress", value: 0.9 },
    { type: "progress", value: 1 },
  ]);
});

test("a page shorter than the screen is read through at once", () => {
  const p = page(500);
  p.run();
  expect(p.posted).toEqual([{ type: "progress", value: 1 }]);
});

test("a page a link led to isn't measured", () => {
  const p = page(4000, "https://blog.dev/other");
  p.run();
  p.scrollTo(2000);
  expect(p.posted).toEqual([]);
});

test("the page's address is data, never code", () => {
  const p = page(4000, "https://blog.dev/a");
  p.run('https://blog.dev/a?"); throw new Error("ran"); ("\u2028');
  expect(p.posted).toEqual([{ type: "progress", value: 0.2 }]);
});
