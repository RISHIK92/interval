// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import { OpponentProgress } from "./OpponentProgress";

// Q-WD-14 (owner, 2026-11-23): a pill per opponent in the match header, read out with
// the full username, kept up to date by polling every 10 seconds until the match is
// over. ADR-0060: it says only whether they're building or have submitted, never how
// many scenarios their design passes.
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

test("a pill per opponent: initials and building, the full username read out", () => {
  const [pill, ...rest] = pills(
    renderToStaticMarkup(
      <OpponentProgress
        matchId="m1"
        initial={{ opponents: [{ player: "rsharma", submitted: false }] }}
      />,
    ),
  );
  expect(rest).toEqual([]);
  expect(pill?.querySelector('[aria-hidden="true"]')?.textContent).toBe("RS");
  expect(pill?.textContent).toBe("RSrsharma · building");
  expect(pill?.querySelector(".sr-only")?.textContent).toBe("rsharma");
});

test("a room shows all three opponents; initials come from a name's two parts", () => {
  const all = pills(
    renderToStaticMarkup(
      <OpponentProgress
        matchId="m1"
        initial={{
          opponents: [
            { player: "ada_lovelace", submitted: true },
            { player: "Grace Hopper", submitted: false },
            { player: "q", submitted: false },
          ],
        }}
      />,
    ),
  );
  expect(
    all.map((p) => p.querySelector('[aria-hidden="true"]')?.textContent),
  ).toEqual(["AL", "GH", "Q"]);
  expect(all.map((p) => p.lastChild?.textContent)).toEqual([
    " · submitted",
    " · building",
    " · building",
  ]);
  expect(all.map((p) => p.textContent).join("")).not.toMatch(/\d/);
});

test("solo: no pills at all", () => {
  expect(
    renderToStaticMarkup(
      <OpponentProgress matchId="m1" initial={{ opponents: [] }} />,
    ),
  ).toBe("");
});

test("polls every 10 seconds, politely, and stops once the match is over", async () => {
  vi.useFakeTimers();
  const answers = [
    Response.json({ opponents: [{ player: "rsharma", submitted: true }] }),
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
        initial={{ opponents: [{ player: "rsharma", submitted: false }] }}
      />,
    );
  });
  expect(host.querySelector("ul")?.getAttribute("aria-live")).toBe("polite");
  expect(host.textContent).toContain("rsharma · building");
  await act(() => vi.advanceTimersByTimeAsync(9_999));
  expect(fetch).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(host.textContent).toContain("rsharma · submitted");
  // Over: the last answer stays, and nothing more is asked.
  await act(() => vi.advanceTimersByTimeAsync(10_000));
  expect(host.textContent).toContain("rsharma · submitted");
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
    root.render(<OpponentProgress matchId="m1" initial={{ opponents: [] }} />);
  });
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(fetch).not.toHaveBeenCalled();
  act(() => {
    root.unmount();
  });
});
