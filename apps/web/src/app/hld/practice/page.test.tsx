import { FAMILIES, practiceProblems } from "@interval/hld";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import type { Actor, Entitlements } from "../../../server/ports";

// The first practice problem (P6-W40: each family's practice seed).
const URL_SHORTENER = (() => {
  const p = practiceProblems(new Date()).find(
    (x) => x.slug === "url-shortener",
  );
  if (p === undefined) throw new Error("no url-shortener practice problem");
  return p;
})();

// P6-W39 (ADR-0042 PROPOSED): the practice problems, for a player with the capability.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const can = vi.fn<Entitlements["can"]>(() => Promise.resolve(true));
vi.mock("../../../server/container", () => ({
  sessionReader: () => ({ current }),
  entitlements: () => ({ can }),
  preferences: () => ({ get: () => Promise.resolve(null) }),
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const { default: PracticePage } = await import("./page");
const ada: Actor = { userId: "u1", isGuest: true, betaGroup: "student" };

test("lists each practice problem with a link to its canvas", async () => {
  current.mockResolvedValue(ada);
  const html = renderToStaticMarkup(await PracticePage());
  expect(html).toContain(`href="/hld/practice/${URL_SHORTENER.slug}"`);
  expect(html).toContain(URL_SHORTENER.title);
  expect(html).toContain('href="/hld/spec"');
});

// ADR-0050 §1, Q-WD-31: once the pools split, only practice families, grouped by theme
// with their difficulty; never a battle family.
test("groups the practice families by theme, each with its difficulty, and no battle family", async () => {
  current.mockResolvedValue(ada);
  const html = renderToStaticMarkup(await PracticePage());
  expect(html).toContain('aria-label="Infrastructure building blocks"');
  expect(html).toContain('aria-label="Commerce &amp; payments"');
  expect(html).toContain('href="/hld/practice/hotel-booking"');
  expect(html).toContain('href="/hld/practice/distributed-cache"');
  expect(html).toMatch(/>easy</);
  expect(html).toMatch(/>medium</);
  for (const battle of FAMILIES.filter((f) => f.pool === "battle"))
    expect(html).not.toContain(`href="/hld/practice/${battle.slug}"`);
  // Grouped in the catalog's theme order: storage before infrastructure.
  expect(html.indexOf("photo-sharing")).toBeLessThan(
    html.indexOf("url-shortener"),
  );
});

test("without a session or the capability, back to Play", async () => {
  current.mockResolvedValueOnce(null);
  await expect(PracticePage()).rejects.toThrow("redirect:/play");
  current.mockResolvedValueOnce(ada);
  can.mockResolvedValueOnce(false);
  await expect(PracticePage()).rejects.toThrow("redirect:/play");
});
