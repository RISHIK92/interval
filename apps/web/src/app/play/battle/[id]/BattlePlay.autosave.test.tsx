// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { BattlePlay } from "./BattlePlay";
import type { CodeEditorProps } from "./CodeEditor";

// Q-WD-17 (owner, 2026-11-23): one file per language, autosaved on the server: a
// battle's code is sent about 2 s after the last edit, restored from the server on a
// reload or another device, and the editor says how the save went.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// The game server's socket never opens here: only the autosave is under test.
vi.mock("../../live/join", () => ({
  openMatch: () => new Promise<WebSocket>(() => undefined),
}));

const typing: { current: (value: string) => void } = {
  current: () => undefined,
};
const typed = (value: string) => {
  typing.current(value);
};
function Editor({ language, value, onChange }: CodeEditorProps) {
  useEffect(() => {
    typing.current = onChange;
  });
  return <textarea aria-label={language} value={value} readOnly />;
}

const MATCH = "6f1c2b8e-3d4a-4e5f-9a0b-1c2d3e4f5a6b";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

function mount(autosaved: Record<string, string>) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <BattlePlay
        matchId={MATCH}
        heading={<h1>LRU cache</h1>}
        signatures={[]}
        statement="# LRU cache"
        examples={[]}
        starters={{ python: "class LRUCache: ...", go: "type LRUCache" }}
        autosaved={autosaved}
        Editor={Editor}
      />,
    );
  });
  const status = () =>
    host.querySelector('[aria-live="polite"][role="status"]');
  return { host, root, status };
}

test("the server's copy first, then a debounced save of the last edit", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn<typeof globalThis.fetch>(() =>
    Promise.resolve(new Response(null, { status: 204 })),
  );
  vi.stubGlobal("fetch", fetch);
  const { host, root, status } = mount({ python: "class Mine: ..." });
  expect(host.querySelector("textarea")?.value).toBe("class Mine: ...");
  act(() => {
    typed("class Mine: 1");
  });
  act(() => {
    typed("class Mine: 2");
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_999);
  });
  const saves = () =>
    fetch.mock.calls.filter(([url]) => url === `/api/battle/${MATCH}/code`);
  expect(saves()).toHaveLength(0);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(saves().map(([url, init]) => [url, init?.body])).toEqual([
    [
      `/api/battle/${MATCH}/code`,
      JSON.stringify({ language: "python", code: "class Mine: 2" }),
    ],
  ]);
  expect(status()?.textContent).toBe("Autosaved");
  act(() => {
    root.unmount();
  });
});

test("a failed save says so, and Retry sends it again", async () => {
  vi.useFakeTimers();
  let ok = false;
  const fetch = vi.fn<typeof globalThis.fetch>(() =>
    Promise.resolve(new Response(null, { status: ok ? 204 : 500 })),
  );
  vi.stubGlobal("fetch", fetch);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const { host, root, status } = mount({});
  expect(host.querySelector("textarea")?.value).toBe("class LRUCache: ...");
  act(() => {
    typed("class Mine: 1");
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_000);
  });
  expect(status()?.textContent).toBe("Not saved · Retry");
  ok = true;
  const retry = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === "Retry",
  );
  await act(async () => {
    retry?.click();
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(
    fetch.mock.calls.filter(([url]) => url === `/api/battle/${MATCH}/code`),
  ).toHaveLength(2);
  expect(status()?.textContent).toBe("Autosaved");
  act(() => {
    root.unmount();
  });
});

test("saving shows while a save is out", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Response>(() => undefined)),
  );
  const { root, status } = mount({});
  act(() => {
    typed("x");
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_000);
  });
  expect(status()?.textContent).toBe("Saving…");
  act(() => {
    root.unmount();
  });
});

test("a failed save, then a reload: the newer code in this tab wins and goes again", async () => {
  vi.useFakeTimers();
  let ok = false;
  const fetch = vi.fn<typeof globalThis.fetch>(() =>
    Promise.resolve(new Response(null, { status: ok ? 204 : 500 })),
  );
  vi.stubGlobal("fetch", fetch);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const first = mount({ python: "class Old: ..." });
  act(() => {
    typed("class Newer: ...");
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_000);
  });
  expect(first.status()?.textContent).toBe("Not saved · Retry");
  act(() => {
    first.root.unmount();
  });
  // The reload: the server still has the old code.
  ok = true;
  fetch.mockClear();
  const again = mount({ python: "class Old: ..." });
  expect(again.host.querySelector("textarea")?.value).toBe("class Newer: ...");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(fetch.mock.calls.map(([, init]) => init?.body)).toEqual([
    JSON.stringify({ language: "python", code: "class Newer: ..." }),
  ]);
  expect(again.status()?.textContent).toBe("Autosaved");
  act(() => {
    again.root.unmount();
  });
  // Saved now: another device's later save is what a reload shows.
  const third = mount({ python: "class FromLaptop: ..." });
  expect(third.host.querySelector("textarea")?.value).toBe(
    "class FromLaptop: ...",
  );
  act(() => {
    third.root.unmount();
  });
});

test("not Autosaved while an edit waits to go", () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
  );
  const { root, status } = mount({});
  act(() => {
    typed("x");
  });
  expect(status()?.textContent).toBe("Saving…");
  act(() => {
    root.unmount();
  });
});
