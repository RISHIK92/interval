import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type { Actor, AdminPaths, ReviewPath } from "../../../server/ports";

// §5F, Q-P2-23, P2-W10-S02: the path review page and its actions exist only for
// admin.review.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const can = vi.fn<(userId: string, capability: string) => Promise<boolean>>();
const list = vi.fn<AdminPaths["list"]>(() => Promise.resolve([]));
const rename = vi.fn<AdminPaths["rename"]>(() => Promise.resolve(true));
const moveSection = vi.fn<AdminPaths["moveSection"]>(() =>
  Promise.resolve(true),
);
const removeSection = vi.fn<AdminPaths["removeSection"]>(() =>
  Promise.resolve(true),
);
const removeSession = vi.fn<AdminPaths["removeSession"]>(() =>
  Promise.resolve(true),
);
const approve = vi.fn<AdminPaths["approve"]>(() => Promise.resolve(true));
const retire = vi.fn<AdminPaths["retire"]>(() => Promise.resolve(true));
vi.mock("../../../server/container", () => ({
  sessionReader: () => ({ current }),
  entitlements: () => ({ can }),
  adminPaths: () => ({
    list,
    rename,
    moveSection,
    removeSection,
    removeSession,
    approve,
    retire,
  }),
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

const draft: ReviewPath = {
  pathId: "6",
  name: "Replication basics",
  why: "Why replicas fall behind.",
  status: "draft",
  sections: [
    {
      sectionId: "60",
      concepts: ["Replication"],
      sessions: [
        {
          ordinal: 0,
          momentId: "900",
          sectionTitle: "Leaders and followers",
          articleTitle: "Designing data systems",
          sourceName: "Pub Engineering",
          link: "https://pub.test/a#leaders",
          allowed: true,
        },
        {
          ordinal: 1,
          momentId: "901",
          sectionTitle: "Copies everywhere",
          articleTitle: "Replicas 101",
          sourceName: "Another Blog",
          link: "https://other.test/b",
          allowed: false,
        },
      ],
    },
    { sectionId: "61", concepts: ["Lag", "Quorum"], sessions: [] },
  ],
};

async function page(query: Record<string, string> = {}): Promise<string> {
  const { default: PathsPage } = await import("./page");
  return renderToStaticMarkup(
    await PathsPage({ searchParams: Promise.resolve(query) }),
  );
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

test("only admin.review holders see the page or can act on it", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(false);
  await expect(page()).rejects.toThrow("notFound");
  const { pathAction } = await import("./actions");
  await expect(
    pathAction(form({ control: "approve", pathId: "6" })),
  ).rejects.toThrow("notFound");
  expect(approve).not.toHaveBeenCalled();
});

test("a draft shows its sections, readings, rights and controls; the live count leads", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);
  list.mockResolvedValueOnce([
    draft,
    { ...draft, pathId: "7", name: "Live one", status: "live" },
  ]);
  const html = await page();
  expect(html).toContain("1 live (launch 5–8)");
  expect(html).toContain("Replication basics");
  expect(html).toContain("Why replicas fall behind.");
  expect(html).toContain("Lag, Quorum");
  expect(html).toContain('href="https://pub.test/a#leaders"');
  expect(html).toContain("Rights changed");
  for (const control of [
    "rename",
    "up",
    "down",
    "remove-section",
    "remove-session",
    "approve",
    "retire",
  ])
    expect(html).toContain(`value="${control}"`);
  // A live path can only be retired here.
  const live = html.slice(html.indexOf("Live one"));
  expect(live).toContain('value="retire"');
  for (const control of [
    "approve",
    "rename",
    "up",
    "down",
    "remove-section",
    "remove-session",
  ])
    expect(live).not.toContain(`value="${control}"`);
  // Each control says what it acts on; the first section can't move up, the last
  // can't move down.
  const first = html.slice(0, html.indexOf("Live one"));
  expect(first).toContain('aria-label="Approve Replication basics"');
  expect(first).toContain('aria-label="Move section 2 up"');
  expect(first).not.toContain('aria-label="Move section 1 up"');
  expect(first).toContain('aria-label="Move section 1 down"');
  expect(first).not.toContain('aria-label="Move section 2 down"');
  expect(first).toContain('aria-label="Remove section 1"');
});

test("each control calls the port once and says how it went", async () => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);
  const { pathAction } = await import("./actions");
  const cases: [Record<string, string>, () => void][] = [
    [
      {
        control: "rename",
        pathId: "6",
        name: " Replicas ",
        why: "How copies.",
      },
      () => {
        expect(rename).toHaveBeenCalledWith("6", "Replicas", "How copies.");
      },
    ],
    [
      { control: "up", sectionId: "61" },
      () => {
        expect(moveSection).toHaveBeenCalledWith("61", "up");
      },
    ],
    [
      { control: "remove-session", sectionId: "60", ordinal: "1" },
      () => {
        expect(removeSession).toHaveBeenCalledWith("60", 1);
      },
    ],
    [
      { control: "remove-section", sectionId: "61" },
      () => {
        expect(removeSection).toHaveBeenCalledWith("61");
      },
    ],
    [
      { control: "approve", pathId: "6" },
      () => {
        expect(approve).toHaveBeenCalledWith("6");
      },
    ],
    [
      { control: "retire", pathId: "6" },
      () => {
        expect(retire).toHaveBeenCalledWith("6");
      },
    ],
  ];
  for (const [fields, check] of cases) {
    await expect(pathAction(form(fields))).rejects.toThrow(
      "redirect:/admin/paths?saved=1",
    );
    check();
  }
  approve.mockResolvedValueOnce(false);
  await expect(
    pathAction(form({ control: "approve", pathId: "6" })),
  ).rejects.toThrow("redirect:/admin/paths?error=refused");
});

test.each([
  { control: "approve", pathId: "x" },
  { control: "sideways", sectionId: "61" },
  { control: "rename", pathId: "6", name: "", why: "w" },
  { control: "rename", pathId: "6", name: "n".repeat(121), why: "w" },
  { control: "rename", pathId: "6", name: "n", why: "w".repeat(501) },
  { control: "remove-session", sectionId: "60", ordinal: "-1" },
  { control: "remove-session", sectionId: "60", ordinal: "" },
  { control: "explode", pathId: "6" },
])("bad input changes nothing: %o", async (fields) => {
  current.mockResolvedValue(admin);
  can.mockResolvedValue(true);
  const { pathAction } = await import("./actions");
  await expect(pathAction(form(fields))).rejects.toThrow("notFound");
  for (const fn of [
    rename,
    moveSection,
    removeSection,
    removeSession,
    approve,
    retire,
  ])
    expect(fn).not.toHaveBeenCalled();
});
