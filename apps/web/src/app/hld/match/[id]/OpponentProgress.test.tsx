// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import { OpponentProgress } from "./OpponentProgress";

// Q-WD-14 (owner, 2026-11-23): the design's "RS · 3 of 5 scenarios", a pill per
// opponent in the match header, read out with the full username, kept up to date by
// polling every 10 seconds until the match is over.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function pills(html: string) {
  const host = document.createElement("div");
  host.innerHTML = html;
  return [...host.querySelectorAll("li")];
}

test("a pill per opponent: initials and the count, the full username read out", () => {
  const [pill, ...rest] = pills(
    renderToStaticMarkup(
      <OpponentProgress
        matchId="m1"
        initial={{ total: 5, opponents: [{ player: "rsharma", passed: 3 }] }}
      />,
    ),
  );
  expect(rest).toEqual([]);
  expect(pill?.querySelector('[aria-hidden="true"]')?.textContent).toBe("RS");
  expect(pill?.textContent).toBe("RSrsharma · 3 of 5 scenarios");
  expect(pill?.querySelector(".sr-only")?.textContent).toBe("rsharma");
});

test("a room shows all three opponents; initials come from a name's two parts", () => {
  const all = pills(
    renderToStaticMarkup(
      <OpponentProgress
        matchId="m1"
        initial={{
          total: 6,
          opponents: [
            { player: "ada_lovelace", passed: 6 },
            { player: "Grace Hopper", passed: 0 },
            { player: "q", passed: 2 },
          ],
        }}
      />,
    ),
  );
  expect(
    all.map((p) => p.querySelector('[aria-hidden="true"]')?.textContent),
  ).toEqual(["AL", "GH", "Q"]);
  expect(all.map((p) => p.lastChild?.textContent)).toEqual([
    " · 6 of 6 scenarios",
    " · 0 of 6 scenarios",
    " · 2 of 6 scenarios",
  ]);
});

test("solo: no pills at all", () => {
  expect(
    renderToStaticMarkup(
      <OpponentProgress matchId="m1" initial={{ total: 5, opponents: [] }} />,
    ),
  ).toBe("");
});

test("polls every 10 seconds, politely, and stops once the match is over", async () => {
  vi.useFakeTimers();
  const answers = [
    Response.json({ total: 5, opponents: [{ player: "rsharma", passed: 4 }] }),
    Response.json({ over: true }, { status: 409 }),
  ];
  const fetch = vi.fn((url: string) => {
    expect(url).toBe("/api/hld/match/m1/progress");
    return Promise.resolve(answers.shift() ?? new Response(null));
  });
  vi.stubGlobal("fetch", fetch);
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => {
    root.render(
      <OpponentProgress
        matchId="m1"
        initial={{ total: 5, opponents: [{ player: "rsharma", passed: 3 }] }}
      />,
    );
  });
  expect(host.querySelector("ul")?.getAttribute("aria-live")).toBe("polite");
  await act(() => vi.advanceTimersByTimeAsync(9_999));
  expect(fetch).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(host.textContent).toContain("4 of 5 scenarios");
  // Over: the last count stays, and nothing more is asked.
  await act(() => vi.advanceTimersByTimeAsync(10_000));
  expect(host.textContent).toContain("4 of 5 scenarios");
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(fetch).toHaveBeenCalledTimes(2);
  act(() => {
    root.unmount();
  });
});

test("a solo match never polls", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const root = createRoot(document.createElement("div"));
  act(() => {
    root.render(
      <OpponentProgress matchId="m1" initial={{ total: 5, opponents: [] }} />,
    );
  });
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(fetch).not.toHaveBeenCalled();
  act(() => {
    root.unmount();
  });
});
