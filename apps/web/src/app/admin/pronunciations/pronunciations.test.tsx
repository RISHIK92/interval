import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type { Actor, AdminPronunciations } from "../../../server/ports";

// P4-W22-S02 (TTS-2, Q-P4-10): the pronunciation dictionary, for admin.review only.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const can = vi.fn<(userId: string, capability: string) => Promise<boolean>>();
const list = vi.fn<AdminPronunciations["list"]>(() => Promise.resolve([]));
const add = vi.fn<AdminPronunciations["add"]>(() =>
  Promise.resolve("added" as const),
);
const remove = vi.fn<AdminPronunciations["remove"]>(() =>
  Promise.resolve(true),
);
vi.mock("../../../server/container", () => ({
  sessionReader: () => ({ current }),
  entitlements: () => ({ can }),
  adminPronunciations: () => ({ list, add, remove }),
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const admin: Actor = { userId: "a1", isGuest: false, betaGroup: "developer" };
afterEach(() => {
  vi.clearAllMocks();
});
const page = async (query: Record<string, string> = {}) => {
  const { default: PronunciationsPage } = await import("./page");
  return renderToStaticMarkup(
    await PronunciationsPage({ searchParams: Promise.resolve(query) }),
  );
};
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

test("the terms, the seed's without Remove; the admin's with it", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);
  list.mockResolvedValue([
    { id: "1", term: "nginx", say: "engine x", origin: "seed" },
    { id: "2", term: "Raft", say: "raft", origin: "admin" },
  ]);
  const html = await page();
  expect(html).toContain("engine x");
  expect(html).toContain("Seed file");
  expect(html).toContain("Added here");
  expect(html.match(/Remove/g)).toHaveLength(1);
  expect(await page({ error: "taken" })).toContain(
    "That term is in the dictionary already.",
  );
});

test("adding: trimmed, by whom; a taken or empty term is said", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);
  const { addPronunciationAction } = await import("./actions");
  await expect(
    addPronunciationAction(form({ term: " kubectl ", say: "cube control" })),
  ).rejects.toThrow("redirect:/admin/pronunciations?saved=1");
  expect(add).toHaveBeenCalledWith("kubectl", "cube control", "a1");
  add.mockResolvedValueOnce("taken");
  await expect(
    addPronunciationAction(form({ term: "kubectl", say: "x" })),
  ).rejects.toThrow("redirect:/admin/pronunciations?error=taken");
  await expect(
    addPronunciationAction(form({ term: "  ", say: "x" })),
  ).rejects.toThrow("redirect:/admin/pronunciations?error=invalid");
  expect(add).toHaveBeenCalledTimes(2);
});

test("anyone without admin.review finds nothing", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(false);
  await expect(page()).rejects.toThrow("notFound");
  const { addPronunciationAction, removePronunciationAction } =
    await import("./actions");
  await expect(
    addPronunciationAction(form({ term: "x", say: "y" })),
  ).rejects.toThrow("notFound");
  await expect(removePronunciationAction(form({ id: "2" }))).rejects.toThrow(
    "notFound",
  );
  expect(add).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
});

test("removing an admin term; a seed term or a gone one is said; a bad id finds nothing", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);
  const { removePronunciationAction } = await import("./actions");
  await expect(removePronunciationAction(form({ id: "2" }))).rejects.toThrow(
    "redirect:/admin/pronunciations?saved=1",
  );
  expect(remove).toHaveBeenCalledWith("2");
  remove.mockResolvedValueOnce(false);
  await expect(removePronunciationAction(form({ id: "1" }))).rejects.toThrow(
    "redirect:/admin/pronunciations?error=kept",
  );
  await expect(removePronunciationAction(form({ id: "x" }))).rejects.toThrow(
    "notFound",
  );
  expect(await page({ error: "kept" })).toContain("Not removed");
});
