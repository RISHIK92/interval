// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { HintPanel } from "./Hints";

// Q-WD-17 (owner, 2026-11-23): "Stuck? Hints cost points": three outlined rows with their
// cost; in a battle a confirm before one opens; opened hints shown in the problem column.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Hints = Parameters<typeof HintPanel>[0]["hints"];
const battle: Hints = { costs: [10, 30, 60], opened: [], spent: 0 };

function mount(
  hints: Hints,
  onOpen = vi.fn<(level: number) => void>(),
  notice: string | null = null,
) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(<HintPanel hints={hints} onOpen={onOpen} notice={notice} />);
  });
  const button = (name: string) => {
    const found = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === name || b.getAttribute("aria-label") === name,
    );
    if (found === undefined) throw new Error(`no button ${name}`);
    return found;
  };
  const click = (name: string) => {
    act(() => {
      button(name).click();
    });
  };
  return { host, onOpen, button, click };
}

test("three rows with their costs; a battle asks before opening one", () => {
  const { host, onOpen, click, button } = mount(battle);
  expect(host.textContent).toContain("Stuck? Hints cost points");
  for (const [row, shown] of [
    ["Nudge, −10 points", "Nudge−10"],
    ["Approach, −30 points", "Approach−30"],
    ["Code sketch, −60 points", "Code sketch−60"],
  ] as const)
    expect(button(row).textContent).toBe(shown);
  click("Approach, −30 points");
  expect(onOpen).not.toHaveBeenCalled();
  expect(host.textContent).toContain(
    "Open the approach? It takes 30 points off your best.",
  );
  click("Cancel");
  expect(host.textContent).not.toContain("Open the approach?");
  click("Approach, −30 points");
  click("Open it");
  expect(onOpen).toHaveBeenCalledWith(2);
});

test("in practice hints are free and open at once", () => {
  const { host, onOpen, click } = mount({
    costs: [0, 0, 0],
    opened: [],
    spent: 0,
  });
  expect(host.textContent).toContain("Stuck? Hints are free in practice");
  expect(host.textContent).not.toContain("−");
  click("Nudge");
  expect(onOpen).toHaveBeenCalledWith(1);
});

test("opened hints are shown, the sketch as code, with what they cost", () => {
  const { host, button } = mount({
    costs: [10, 30, 60],
    opened: [
      { level: 1, text: "Think about recency." },
      { level: 3, text: "get(k):\n  move to front" },
    ],
    spent: 70,
  });
  expect(host.textContent).toContain("Think about recency.");
  expect(host.querySelector("pre")?.textContent).toBe(
    "get(k):\n  move to front",
  );
  expect(host.textContent).toContain("Hints: −70");
  // An opened level isn't offered again.
  expect(button("Nudge, opened").disabled).toBe(true);
});

test("a hint that couldn't be asked for is said", () => {
  const { host } = mount(battle, undefined, "Not connected: try again.");
  expect(host.querySelector('[role="status"]')?.textContent).toBe(
    "Not connected: try again.",
  );
});
