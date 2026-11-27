// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import type { BattleMode } from "../../server/ports";
import { RankedBattles } from "./RankedBattles";

// Play hub, web: the rail registers for the next ranked window (MATCH-7) the way the
// lobbies do, for each battle on the plan, and says where the player stands.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
// Unmounted inside act, so no React work is left to run once jsdom is torn down (CI
// saw "window is not defined" from the scheduler after this file finished).
afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
  vi.unstubAllGlobals();
});

function mount(
  status: "open" | "closed" | "live",
  lld: BattleMode | null,
  hld: BattleMode | null,
) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root.render(
      <RankedBattles
        at={new Date(Date.now() + 3_600_000).toISOString()}
        status={status}
        games={[
          { game: "lld", registered: lld },
          { game: "hld", registered: hld },
        ]}
      />,
    );
  });
}

const button = () => host.querySelector("button");
const click = async (el: HTMLElement | null) => {
  await act(async () => {
    el?.click();
    await Promise.resolve();
  });
};

test("registers for LLD in Human mode, then cancels", async () => {
  const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
    () => Promise.resolve(new Response(null, { status: 204 })),
  );
  vi.stubGlobal("fetch", fetch);
  mount("open", null, null);
  expect(button()?.textContent).toBe("Register for LLD");
  await click(button());
  expect(fetch).toHaveBeenLastCalledWith(
    "/api/battle/window?mode=human",
    expect.objectContaining({ method: "POST" }),
  );
  expect(button()?.textContent).toBe("Registered · cancel");
  await click(button());
  expect(fetch).toHaveBeenLastCalledWith(
    "/api/battle/window?mode=human",
    expect.objectContaining({ method: "DELETE" }),
  );
  expect(button()?.textContent).toBe("Register for LLD");
});

test("System design registers apart, at HLD's windows", async () => {
  const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
    () => Promise.resolve(new Response(null, { status: 204 })),
  );
  vi.stubGlobal("fetch", fetch);
  mount("open", null, null);
  await click(host.querySelector<HTMLInputElement>('input[value="hld"]'));
  expect(button()?.textContent).toBe("Register for System design");
  await click(button());
  expect(fetch).toHaveBeenLastCalledWith(
    "/api/hld/window?mode=human",
    expect.objectContaining({ method: "POST" }),
  );
});

test("opens on the battle already registered for, in the mode chosen in the lobby", () => {
  mount("open", null, "ai");
  expect(
    host.querySelector<HTMLInputElement>('input[value="hld"]')?.checked,
  ).toBe(true);
  expect(button()?.textContent).toBe("Registered · cancel");
  expect(host.textContent).toContain("AI mode · change in the lobby");
});

test("a refused registration says registration has closed", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(null, { status: 409 }))),
  );
  mount("open", null, null);
  await click(button());
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(
    "Registration has closed for this window.",
  );
  expect(button()?.textContent).toBe("Register for LLD");
});

test("once closed: no button; a registered player goes to the lobby", () => {
  mount("closed", null, null);
  expect(button()).toBe(null);
  expect(host.textContent).toContain("Registration has closed.");
  host.remove();
  mount("live", "human", null);
  expect(host.querySelector('a[href="/play/battle"]')?.textContent).toBe(
    "Go to your room",
  );
});
