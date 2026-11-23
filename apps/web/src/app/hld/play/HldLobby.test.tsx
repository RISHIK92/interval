// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import { HldLobby } from "./HldLobby";

// P6-W42 (MATCH-7, Q-P6-06): nobody in the casual queue for a minute, so the lobby
// starts a solo match and opens it. Found by the walkthrough: the match was made, but
// the page never went to it.
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

test("after a minute alone in the queue, the solo match opens", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: { method?: string }) => {
      const method = init?.method ?? "GET";
      // A real request takes a moment: React re-renders before it answers.
      if (url.startsWith("/api/hld/solo"))
        return new Promise<Response>((done) =>
          setTimeout(() => {
            done(Response.json({ matchId: "m-solo" }, { status: 201 }));
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
      <HldLobby
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
  expect(push).toHaveBeenCalledWith("/hld/match/m-solo");
  act(() => {
    root.unmount();
  });
});

// ADR-0047: the register button names the battle mode as the glossary does.
test("registering names the chosen battle mode", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <HldLobby
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
  const buttons = () =>
    [...host.querySelectorAll("button")].map((b) => b.textContent);
  expect(buttons()).toContain("Register");
  expect(host.textContent).toContain("In Human mode");
  act(() => {
    host.querySelector<HTMLInputElement>('input[value="ai"]')?.click();
  });
  expect(host.textContent).toContain("In AI mode");
  act(() => {
    root.unmount();
  });
});

// The window's time is in the player's own zone, which the server doesn't know: it
// renders a placeholder, so hydration matches and the browser fills the time in.
test("on the server, the next window shows no local time", () => {
  const html = renderToString(
    <HldLobby
      window={{
        at: "2026-11-24T21:00:00.000Z",
        status: "open",
        registered: false,
        battleMode: null,
        matchId: null,
      }}
    />,
  );
  expect(html).toContain("Next: …. Rooms of up to 4");
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

// The queue shows how long the player has waited, and lets them leave it: no solo match
// starts after a cancel.
test("waiting shows the time, and Cancel leaves the queue", async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn((url: string, init?: { method?: string }) => {
    const method = init?.method ?? "GET";
    if (method === "PUT")
      return Promise.resolve(Response.json({ status: "waiting" }));
    if (url.startsWith("/api/hld/solo"))
      return Promise.resolve(Response.json({ matchId: "m-solo" }));
    return Promise.resolve(new Response(null, { status: 204 }));
  });
  vi.stubGlobal("fetch", fetchMock);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <HldLobby
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
  const button = (text: string) =>
    [...host.querySelectorAll("button")].find((b) =>
      b.textContent.includes(text),
    );
  await act(async () => {
    button("Find a match")?.click();
    await vi.advanceTimersByTimeAsync(0);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(42_000);
  });
  expect(host.textContent).toContain("Looking for an opponent…0:42");
  expect(host.textContent).toContain("You'll design solo instead");
  await act(async () => {
    button("Cancel")?.click();
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(
    fetchMock.mock.calls.some(
      ([url, init]) =>
        url.startsWith("/api/hld/queue") && init?.method === "DELETE",
    ),
  ).toBe(true);
  expect(button("Find a match")).toBeDefined();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(
    fetchMock.mock.calls.some(([url]) => url.startsWith("/api/hld/solo")),
  ).toBe(false);
  expect(push).not.toHaveBeenCalled();
  act(() => {
    root.unmount();
  });
});

// One solo at a time: a refused solo says why and leads to the match still going,
// rather than leaving the player at a dead end.
test("a refused solo links to the open match", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: { method?: string }) => {
      if (url.startsWith("/api/hld/solo"))
        return Promise.resolve(new Response(null, { status: 429 }));
      if (init?.method === "PUT")
        return Promise.resolve(Response.json({ status: "waiting" }));
      return Promise.resolve(new Response(null, { status: 204 }));
    }),
  );
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <HldLobby
        openMatch={{
          id: "m-open",
          deadline: new Date(Date.now() + 600_000).toISOString(),
        }}
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
  await act(async () => {
    [...host.querySelectorAll("button")]
      .find((b) => b.textContent.includes("Find a match"))
      ?.click();
    await vi.advanceTimersByTimeAsync(0);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(62_000);
  });
  expect(host.textContent).toContain("a solo match can't start yet");
  expect(host.querySelector('a[href="/hld/match/m-open"]')?.textContent).toBe(
    "Open your match",
  );
  expect(push).not.toHaveBeenCalled();
  act(() => {
    root.unmount();
  });
});
