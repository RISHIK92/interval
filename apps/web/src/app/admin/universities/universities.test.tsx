import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type {
  Actor,
  AdminUniversities,
  Leaderboards,
  PlayerUniversities,
} from "../../../server/ports";

// P3-W14-S03 (ADR-0032): typed universities, tidied by the owner (admin.review only).
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const can = vi.fn<(userId: string, capability: string) => Promise<boolean>>();
const typed = vi.fn<AdminUniversities["typed"]>(() => Promise.resolve([]));
const rename = vi.fn<AdminUniversities["rename"]>(() =>
  Promise.resolve("renamed" as const),
);
const merge = vi.fn<AdminUniversities["merge"]>(() =>
  Promise.resolve(["p1", "p2"]),
);
const remove = vi.fn<AdminUniversities["remove"]>(() =>
  Promise.resolve(["p3"]),
);
const invalidate = vi.fn<Leaderboards["invalidate"]>(() => Promise.resolve());
const search = vi.fn<PlayerUniversities["search"]>(() => Promise.resolve([]));
vi.mock("../../../server/container", () => ({
  sessionReader: () => ({ current }),
  entitlements: () => ({ can }),
  adminUniversities: () => ({ typed, rename, merge, remove }),
  playerUniversities: () => ({ search }),
  leaderboards: () => ({ invalidate }),
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

async function page(query: Record<string, string> = {}): Promise<string> {
  const { default: UniversitiesPage } = await import("./page");
  return renderToStaticMarkup(
    await UniversitiesPage({ searchParams: Promise.resolve(query) }),
  );
}

test("only admin.review sees the page", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(false);
  await expect(page()).rejects.toThrow("notFound");
  current.mockResolvedValue(null);
  await expect(page()).rejects.toThrow("notFound");
});

test("typed universities with their members and forms; a search shows ids to merge into", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);
  typed.mockResolvedValueOnce([{ id: "9", name: "Night School", members: 2 }]);
  search.mockResolvedValueOnce([
    {
      id: "7",
      name: "Indian Institute of Technology Delhi",
      country: "IN",
      listed: true,
    },
  ]);
  const html = await page({ q: "delhi" });
  expect(search).toHaveBeenCalledExactlyOnceWith("delhi", 50);
  expect(html).toContain("Night School");
  expect(html).toMatch(/<td>2<\/td>/);
  for (const op of ["rename", "merge", "remove"])
    expect(html).toMatch(
      new RegExp(`name="universityId" value="9"[^]*?value="${op}"`),
    );
  expect(html).toContain("Indian Institute of Technology Delhi");
  expect(html).toMatch(/<td>7<\/td>/);
});

test("no typed universities and no search: says so, nothing searched", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);
  const html = await page();
  expect(html).toContain("No typed universities.");
  expect(search).not.toHaveBeenCalled();
});

test("the actions check access and ids, and say what went wrong", async () => {
  const { tidyUniversityAction } = await import("./actions");
  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [k, v] of Object.entries(fields)) data.set(k, v);
    return data;
  };
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);

  await expect(
    tidyUniversityAction(
      form({ universityId: "9", op: "rename", name: " Night  College " }),
    ),
  ).rejects.toThrow("redirect:/admin/universities?saved=1");
  expect(rename).toHaveBeenCalledWith("9", "Night College");
  rename.mockResolvedValueOnce("taken");
  await expect(
    tidyUniversityAction(
      form({ universityId: "9", op: "rename", name: "X Y" }),
    ),
  ).rejects.toThrow("redirect:/admin/universities?error=taken");
  await expect(
    tidyUniversityAction(form({ universityId: "9", op: "rename", name: "x" })),
  ).rejects.toThrow("redirect:/admin/universities?error=name");

  await expect(
    tidyUniversityAction(form({ universityId: "9", op: "merge", intoId: "7" })),
  ).rejects.toThrow("redirect:/admin/universities?saved=1");
  expect(merge).toHaveBeenCalledWith("9", "7");
  // P3-W14-S04: each moved player's boards, with the university they left.
  expect(invalidate.mock.calls).toEqual([
    ["p1", [{ university: "9" }]],
    ["p2", [{ university: "9" }]],
  ]);
  merge.mockResolvedValueOnce(null);
  await expect(
    tidyUniversityAction(form({ universityId: "9", op: "merge", intoId: "8" })),
  ).rejects.toThrow("redirect:/admin/universities?error=merge");
  await expect(
    tidyUniversityAction(form({ universityId: "9", op: "merge", intoId: "x" })),
  ).rejects.toThrow("redirect:/admin/universities?error=merge");

  await expect(
    tidyUniversityAction(form({ universityId: "9", op: "remove" })),
  ).rejects.toThrow("redirect:/admin/universities?saved=1");
  expect(remove).toHaveBeenCalledWith("9");
  expect(invalidate).toHaveBeenLastCalledWith("p3", [{ university: "9" }]);
  expect(invalidate).toHaveBeenCalledTimes(3);
  remove.mockResolvedValueOnce(null);
  await expect(
    tidyUniversityAction(form({ universityId: "9", op: "remove" })),
  ).rejects.toThrow("redirect:/admin/universities?error=missing");

  await expect(
    tidyUniversityAction(form({ universityId: "9", op: "delete" })),
  ).rejects.toThrow("notFound");
  await expect(
    tidyUniversityAction(form({ universityId: "x", op: "remove" })),
  ).rejects.toThrow("notFound");
  can.mockResolvedValue(false);
  await expect(
    tidyUniversityAction(form({ universityId: "9", op: "remove" })),
  ).rejects.toThrow("notFound");
  expect(remove).toHaveBeenCalledTimes(2);
});
