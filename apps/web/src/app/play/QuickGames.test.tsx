// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { type QuickGame, QuickGames } from "./QuickGames";

// Play hub, web: pick a quick game, then how to play it; the panel shows that game's
// way in, and only that one.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const game = (
  name: string,
  ways: Partial<Pick<QuickGame, "solo" | "live" | "note">>,
): QuickGame => ({
  name,
  format: "",
  about: `About ${name}`,
  icon: null,
  tint: "",
  panel: "",
  art: null,
  solo: null,
  live: null,
  note: "",
  ...ways,
});

const GAMES = [
  game("Sprint", {
    solo: <button type="submit">start sprint</button>,
    live: <a href="/play/live/sprint">live sprint</a>,
  }),
  game("Finger", { live: <a href="/play/live/fastest-finger">finger</a> }),
  game("Estimation", { note: "Not on your plan" }),
];

let host: HTMLDivElement;
afterEach(() => {
  host.remove();
});

function mount() {
  host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(<QuickGames games={GAMES} />);
  });
}

const radios = (name: string) =>
  [...host.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)].map(
    (input) => ({ input, label: input.closest("label")?.textContent ?? "" }),
  );
// What a click or the Space key on a focused radio does.
const choose = (name: string, label: string) => {
  const radio = radios(name).find((r) => r.label.includes(label));
  act(() => {
    radio?.input.focus();
    radio?.input.click();
  });
};

test("both choices are native radio groups, named for screen readers", () => {
  mount();
  // One group per choice: the browser moves between them with the arrow keys and
  // tabs only to the checked one.
  const games = radios("quick-game");
  expect(games.map((r) => r.input.type)).toEqual(["radio", "radio", "radio"]);
  expect(games.map((r) => r.input.checked)).toEqual([true, false, false]);
  expect(
    [...host.querySelectorAll("legend")].map((l) => l.textContent),
  ).toEqual(["Quick game", "How to play"]);
  expect(radios("quick-mode").map((r) => r.input.checked)).toEqual([
    true,
    false,
  ]);
});

test("the sprint starts solo by default, or live once 1v1 live is chosen", () => {
  mount();
  expect(host.textContent).toContain("start sprint");
  expect(host.textContent).not.toContain("live sprint");
  choose("quick-mode", "1v1 live");
  expect(host.textContent).toContain("live sprint");
  expect(host.textContent).not.toContain("start sprint");
});

test("a live-only game has no choice of how to play; a game off the plan says so", () => {
  mount();
  choose("quick-game", "Finger");
  expect(host.textContent).toContain("About Finger");
  expect(host.querySelector('a[href="/play/live/fastest-finger"]')).not.toBe(
    null,
  );
  expect(radios("quick-mode")).toHaveLength(0);
  choose("quick-game", "Estimation");
  expect(host.textContent).toContain("Not on your plan");
  expect(host.querySelector("a, button")).toBe(null);
  // Back to the sprint, the chosen way of playing it is kept.
  choose("quick-game", "Sprint");
  expect(host.textContent).toContain("start sprint");
});
