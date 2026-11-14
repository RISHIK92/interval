import { starterDesign, URL_SHORTENER } from "@interval/hld";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import type {
  Actor,
  Entitlements,
  HldPracticeDesigns,
} from "../../../../server/ports";

// P6-W39 (CANVAS-1, ADR-0042 PROPOSED): a practice problem's page opens on the player's
// last autosave, or on the client alone.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const can = vi.fn<Entitlements["can"]>(() => Promise.resolve(true));
const load = vi.fn<HldPracticeDesigns["load"]>(() => Promise.resolve(null));
vi.mock("../../../../server/container", () => ({
  sessionReader: () => ({ current }),
  entitlements: () => ({ can }),
  hldPracticeDesigns: () => ({ load }),
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));
const canvas = vi.fn();
vi.mock("./Canvas", () => ({
  Canvas: (props: unknown) => {
    canvas(props);
    return null;
  },
}));

const { default: PracticeProblemPage } = await import("./page");
const ada: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };
const render = async (slug: string) =>
  renderToStaticMarkup(
    await PracticeProblemPage({ params: Promise.resolve({ slug }) }),
  );

beforeEach(() => {
  current.mockResolvedValue(ada);
  can.mockResolvedValue(true);
  canvas.mockClear();
});

test("shows the problem and opens the canvas on the saved design", async () => {
  const saved = {
    ...starterDesign(),
    nodes: [...starterDesign().nodes],
  };
  load.mockResolvedValueOnce({ design: saved, version: 4 });
  const html = await render(URL_SHORTENER.slug);
  expect(html).toContain(URL_SHORTENER.title);
  expect(html).toContain(URL_SHORTENER.requirements[0]);
  expect(canvas).toHaveBeenCalledWith(
    expect.objectContaining({ initial: saved, version: 4 }),
  );
});

test("a saved design that no longer parses starts over, at its version", async () => {
  load.mockResolvedValueOnce({ design: { version: 0 }, version: 2 });
  await render(URL_SHORTENER.slug);
  expect(canvas).toHaveBeenCalledWith(
    expect.objectContaining({ initial: starterDesign(), version: 2 }),
  );
});

test("an unknown problem is not found; no session or capability goes to Play", async () => {
  await expect(render("nope")).rejects.toThrow("notFound");
  current.mockResolvedValueOnce(null);
  await expect(render(URL_SHORTENER.slug)).rejects.toThrow("redirect:/play");
  can.mockResolvedValueOnce(false);
  await expect(render(URL_SHORTENER.slug)).rejects.toThrow("redirect:/play");
});
