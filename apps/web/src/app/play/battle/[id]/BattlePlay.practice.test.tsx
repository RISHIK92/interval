// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { BattlePlay, type PracticeSave } from "./BattlePlay";
import type { CodeEditorProps } from "./CodeEditor";

// ADR-0048 (Q-WD-28): practice code starts from the player's saved copy and is saved
// about 2 s after the last edit, each save over the version the one before made; a
// stale save is said, not forced.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

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

afterEach(() => {
  vi.useRealTimers();
});

function mount(save: PracticeSave) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <BattlePlay
        matchId={null}
        heading={<h1>LRU cache</h1>}
        signatures={[]}
        statement="# LRU cache"
        examples={[]}
        starters={{ python: "class LRUCache: ...", go: "type LRUCache" }}
        Editor={Editor}
        practice={{
          best: null,
          hasExtension: true,
          saved: { python: { code: "class Mine: ...", version: 4 } },
          save,
          onEnded: () => undefined,
        }}
      />,
    );
  });
  return { host, root };
}

test("the saved copy, then a debounced save over each version in turn", async () => {
  vi.useFakeTimers();
  const save = vi.fn<PracticeSave>((_l, _c, base) =>
    Promise.resolve({ ok: true, version: base + 1 }),
  );
  const { host, root } = mount(save);
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
  expect(save).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(save.mock.calls).toEqual([["python", "class Mine: 2", 4]]);
  act(() => {
    typed("class Mine: 3");
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_000);
  });
  expect(save.mock.calls.at(-1)).toEqual(["python", "class Mine: 3", 5]);
  act(() => {
    root.unmount();
  });
});

test("a stale save is said", async () => {
  vi.useFakeTimers();
  const { host, root } = mount(() =>
    Promise.resolve({ ok: false, reason: "stale" }),
  );
  act(() => {
    typed("class Mine: 1");
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_000);
  });
  expect(host.textContent).toContain("Saved in another tab: reload to get it.");
  act(() => {
    root.unmount();
  });
});
