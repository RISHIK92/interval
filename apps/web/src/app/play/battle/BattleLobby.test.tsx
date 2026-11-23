// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import { BattleLobby, BattleLobbyView } from "./BattleLobby";

// P5-W32 (§6.6, Q-P5-19): nobody in the casual queue for a minute, so the lobby starts
// a solo battle and opens it. Found by the P6 walkthrough in HLD's lobby, which shares
// the pattern: the battle was made, but the page never went to it.
const push = vi.fn<(url: string) => void>();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  push.mockClear();
});

test("after a minute alone in the queue, the solo battle opens", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: { method?: string }) => {
      const method = init?.method ?? "GET";
      // A real request takes a moment: React re-renders before it answers.
      if (url.startsWith("/api/battle/solo"))
        return new Promise<Response>((done) =>
          setTimeout(() => {
            done(Response.json({ matchId: "b-solo" }, { status: 201 }));
          }, 100),
        );
      if (method === "PUT")
        return Promise.resolve(Response.json({ status: "waiting" }));
      return Promise.resolve(new Response(null, { status: 204 }));
    }),
  );
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <BattleLobby
        window={{
          at: new Date(Date.now() + 3_600_000).toISOString(),
          status: "open",
          registered: false,
          battleMode: null,
          matchId: null,
        }}
      />,
    );
  });
  const find = [...host.querySelectorAll("button")].find((b) =>
    b.textContent.includes("Find a match"),
  );
  await act(async () => {
    find?.click();
    await vi.advanceTimersByTimeAsync(0);
  });
  // Outside act, as in a browser: React re-renders as soon as the lobby says "solo",
  // while the solo request is still out.
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = false;
  for (let ms = 0; ms < 62_000; ms += 50) await vi.advanceTimersByTimeAsync(50);
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  expect(push).toHaveBeenCalledWith("/play/battle/b-solo");
  act(() => {
    root.unmount();
  });
});

// Q-P5-19: one solo at a time. Refused, the lobby says a solo is running and leads to it.
test("with a solo already running, the lobby links to it", () => {
  const html = renderToString(
    <BattleLobbyView
      casual="idle"
      window={{
        at: "2026-11-24T21:00:00.000Z",
        status: "open",
        registered: false,
        battleMode: null,
        matchId: null,
      }}
      problem={{ soloRunning: "b-running" }}
      battleMode="human"
      onBattleMode={() => undefined}
      onCasual={() => undefined}
      onRegister={() => undefined}
    />,
  );
  expect(html).toContain("You already have a solo battle running.");
  expect(html).toContain('href="/play/battle/b-running"');
});

// ADR-0047: registered in one battle mode with the other chosen, the button names it as
// the glossary does.
test("a registration moves to the other battle mode by name", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <BattleLobby
        window={{
          at: new Date(Date.now() + 3_600_000).toISOString(),
          status: "open",
          registered: true,
          battleMode: "ai",
          matchId: null,
        }}
      />,
    );
  });
  const buttons = () =>
    [...host.querySelectorAll("button")].map((b) => b.textContent);
  expect(buttons()).toContain("Registered: cancel");
  act(() => {
    host.querySelector<HTMLInputElement>('input[value="human"]')?.click();
  });
  expect(buttons()).toContain("Switch to Human mode");
  act(() => {
    root.unmount();
  });
});

// The window's time is in the player's own zone, which the server doesn't know: it
// renders a placeholder, so hydration matches and the browser fills the time in.
test("on the server, the next window shows no local time", () => {
  const html = renderToString(
    <BattleLobbyView
      casual="idle"
      window={{
        at: "2026-11-24T21:00:00.000Z",
        status: "open",
        registered: false,
        battleMode: null,
        matchId: null,
      }}
      problem={null}
      battleMode="human"
      onBattleMode={() => undefined}
      onCasual={() => undefined}
      onRegister={() => undefined}
    />,
  );
  expect(html).toContain("Next: …, 45 minutes.");
  for (const day of [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ])
    expect(html).not.toContain(day);
});

// ADR-0048 (Q-WD-28): practice is the lobby's third way in, after the others.
test("the lobby links to practice, after the ranked window and the casual queue", () => {
  const html = renderToString(
    <BattleLobbyView
      casual="idle"
      window={{
        at: "2026-11-24T21:00:00.000Z",
        status: "open",
        registered: false,
        battleMode: null,
        matchId: null,
      }}
      problem={null}
      battleMode="human"
      onBattleMode={() => undefined}
      onCasual={() => undefined}
      onRegister={() => undefined}
    />,
  );
  expect(html).toContain('href="/play/battle/practice"');
  expect(html).toContain("No clock, unrated");
  const at = (text: string) => html.indexOf(text);
  expect(at("Ranked window")).toBeLessThan(at("Casual battle"));
  expect(at("Casual battle")).toBeLessThan(at('href="/play/battle/practice"'));
});
