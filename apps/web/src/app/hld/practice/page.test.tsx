import { URL_SHORTENER } from "@interval/hld";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import type { Actor, Entitlements } from "../../../server/ports";

// P6-W39 (ADR-0042 PROPOSED): the practice problems, for a player with the capability.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const can = vi.fn<Entitlements["can"]>(() => Promise.resolve(true));
vi.mock("../../../server/container", () => ({
  sessionReader: () => ({ current }),
  entitlements: () => ({ can }),
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

test("without a session or the capability, back to Play", async () => {
  current.mockResolvedValueOnce(null);
  await expect(PracticePage()).rejects.toThrow("redirect:/play");
  current.mockResolvedValueOnce(ada);
  can.mockResolvedValueOnce(false);
  await expect(PracticePage()).rejects.toThrow("redirect:/play");
});
