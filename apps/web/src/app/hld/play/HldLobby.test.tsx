// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
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
    b.textContent.includes("Find an opponent"),
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
  expect(buttons()).toContain("Register (Human mode)");
  act(() => {
    host.querySelector<HTMLInputElement>('input[value="ai"]')?.click();
  });
  expect(buttons()).toContain("Register (AI mode)");
  act(() => {
    root.unmount();
  });
});
