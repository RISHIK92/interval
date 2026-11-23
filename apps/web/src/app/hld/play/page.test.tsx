import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import type { Actor } from "../../../server/ports";

const ada: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };
vi.mock("../../../server/container", () => ({
  sessionReader: () => ({ current: () => Promise.resolve(ada) }),
  entitlements: () => ({ can: () => Promise.resolve(true) }),
  hldDeps: () => ({}),
  hldMatches: () => ({
    unscoredFor: () => Promise.resolve([]),
    ratingOf: () => Promise.resolve(1500),
  }),
  hldWindows: () => ({ registration: () => Promise.resolve(null) }),
  preferences: () => ({ get: () => Promise.resolve(null) }),
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
  useRouter: () => ({ push: vi.fn() }),
}));

const { default: HldPlayPage } = await import("./page");

// Phones keep the lobby's order from before the web design: the title with its links
// (the spec sheet, practice, tournaments), the battle mode, the casual queue, then the
// ranked window. Wide screens place the cards by the design, not by reordering the DOM.
test("on phones, the lobby reads title and links, mode, casual, then ranked", async () => {
  const html = renderToStaticMarkup(await HldPlayPage());
  const at = (needle: string) => {
    const i = html.indexOf(needle);
    expect(i, needle).toBeGreaterThanOrEqual(0);
    return i;
  };
  const order = [
    at("System design battles"),
    at('href="/hld/spec"'),
    at('href="/hld/practice"'),
    at('href="/hld/tournaments"'),
    at('name="battleMode"'),
    at("Find an opponent"),
    at('aria-label="Ranked window"'),
  ];
  expect(order).toEqual([...order].sort((a, b) => a - b));
  // The header's links are the phone's way in; the practice and tournament cards are
  // the wide layout's, so phones don't get them twice.
  expect(html).toMatch(
    /<li class="hidden lg:block"><section aria-label="Practice"/,
  );
  expect(html).toMatch(
    /<li class="hidden lg:block"><section aria-label="Tournaments"/,
  );
});
