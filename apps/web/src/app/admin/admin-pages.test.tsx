import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Actor, AdminReview, ReviewItem } from "../../server/ports";

// ING-6, Q-P1-29, P1-W3-S05: the review pages and actions exist only for admin.review.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const can = vi.fn<(userId: string, capability: string) => Promise<boolean>>();
const review = {
  recent: vi.fn<AdminReview["recent"]>(),
  item: vi.fn<AdminReview["item"]>(),
  activeConcepts: vi.fn<AdminReview["activeConcepts"]>(() =>
    Promise.resolve(["write-ahead-log"]),
  ),
  setBoundaries: vi.fn<AdminReview["setBoundaries"]>(() => Promise.resolve()),
  setTags: vi.fn<AdminReview["setTags"]>(() => Promise.resolve()),
};
const enqueue = vi.fn(() => Promise.resolve());
const sources = {
  list: vi.fn(() =>
    Promise.resolve([
      {
        id: "3",
        name: "Blog",
        rightsProfile: "full_text_internal",
        active: true,
        momentsSeeded: true,
        momentsSwitchedOff: false,
        momentsEnabled: true,
      },
    ]),
  ),
  get: vi.fn(),
  setMomentsSwitchedOff: vi.fn(() => Promise.resolve()),
  fullTextItemIds: vi.fn(() => Promise.resolve([])),
};
vi.mock("../../server/container", () => ({
  sessionReader: () => ({ current }),
  entitlements: () => ({ can }),
  adminReview: () => review,
  adminSources: () => sources,
  jobQueue: () => ({ enqueue }),
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

const admin: Actor = {
  userId: "admin-1",
  isGuest: false,
  betaGroup: "developer",
};
const item: ReviewItem = {
  id: "7",
  title: "How our WAL works",
  url: "https://blog.example.test/wal",
  sourceName: "Blog",
  sections: [
    { heading: null, level: null, wordCount: 80 },
    { heading: "Setup", level: 2, wordCount: 400 },
  ],
  moments: [
    {
      ordinal: 0,
      title: "How our WAL works",
      heading: null,
      estimatedMinutes: 1,
      oversized: false,
    },
    {
      ordinal: 1,
      title: "Setup",
      heading: "Setup",
      estimatedMinutes: 9,
      oversized: true,
    },
  ],
  modelTags: {
    item: { difficulty: "intermediate", concepts: ["write-ahead-log"] },
    moments: new Map(),
  },
  boundaries: ["Setup"],
  tagOverrides: new Map([["Setup", { difficulty: "advanced", concepts: [] }]]),
};

afterEach(() => {
  vi.clearAllMocks();
});

async function itemPage(query: Record<string, string> = {}): Promise<string> {
  const { default: Page } = await import("./items/[id]/page");
  return renderToStaticMarkup(
    await Page({
      params: Promise.resolve({ id: "7" }),
      searchParams: Promise.resolve(query),
    }),
  );
}

describe("access", () => {
  test.each([
    ["no session", null, false],
    ["a user without admin.review", admin, false],
  ])("%s gets a 404 and nothing is read", async (_case, actor, allowed) => {
    current.mockResolvedValue(actor);
    can.mockResolvedValue(allowed);
    await expect(itemPage()).rejects.toThrow("notFound");
    const { default: List } = await import("./items/page");
    await expect(List()).rejects.toThrow("notFound");
    expect(review.item).not.toHaveBeenCalled();
    expect(review.recent).not.toHaveBeenCalled();
  });

  test("actions check access themselves, so a direct post is refused", async () => {
    current.mockResolvedValue(admin);
    can.mockResolvedValue(false);
    const { saveBoundariesAction, saveTagsAction } =
      await import("./items/[id]/actions");
    const form = new FormData();
    form.set("itemId", "7");
    await expect(saveBoundariesAction(form)).rejects.toThrow("notFound");
    await expect(saveTagsAction(form)).rejects.toThrow("notFound");
    expect(review.setBoundaries).not.toHaveBeenCalled();
    expect(review.setTags).not.toHaveBeenCalled();
  });
});

describe("for an admin", () => {
  test("the item shows its moments, tags, overrides and boundaries", async () => {
    current.mockResolvedValue(admin);
    can.mockResolvedValue(true);
    review.item.mockResolvedValue(item);
    const html = await itemPage({ saved: "1" });
    expect(can).toHaveBeenCalledWith("admin-1", "admin.review");
    expect(html).toContain("Setup · 9 min · oversized");
    expect(html).toContain("Model: intermediate · write-ahead-log");
    expect(html).toContain("Override: advanced · no concepts");
    expect(html).toContain('name="boundary" checked="" value="Setup"');
    expect(html).toContain("Saved.");
  });

  test("only known error codes are shown, as fixed text", async () => {
    current.mockResolvedValue(admin);
    can.mockResolvedValue(true);
    review.item.mockResolvedValue(item);
    const crafted = await itemPage({
      error: "Session expired, sign in at evil.example",
    });
    expect(crafted).not.toContain("evil.example");
    const real = await itemPage({
      error: "unknown-concept",
      detail: "made-up",
    });
    expect(real).toContain("Not in the concept graph:");
    expect(real).toContain("<code>made-up</code>");
  });

  test("an unknown item is a 404", async () => {
    current.mockResolvedValue(admin);
    can.mockResolvedValue(true);
    review.item.mockResolvedValue(null);
    await expect(itemPage()).rejects.toThrow("notFound");
  });

  test("saving boundaries re-segments and comes back to the page", async () => {
    current.mockResolvedValue(admin);
    can.mockResolvedValue(true);
    review.item.mockResolvedValue(item);
    const { saveBoundariesAction } = await import("./items/[id]/actions");
    const form = new FormData();
    form.set("itemId", "7");
    form.append("boundary", "Setup");
    await expect(saveBoundariesAction(form)).rejects.toThrow(
      "redirect:/admin/items/7?saved=1",
    );
    expect(review.setBoundaries).toHaveBeenCalledWith(
      "7",
      ["Setup"],
      "admin-1",
    );
    expect(enqueue).toHaveBeenCalledOnce();
  });

  test("a refused tag edit comes back with the reason", async () => {
    current.mockResolvedValue(admin);
    can.mockResolvedValue(true);
    review.item.mockResolvedValue(item);
    const { saveTagsAction } = await import("./items/[id]/actions");
    const form = new FormData();
    form.set("itemId", "7");
    form.set("heading", "");
    form.set("difficulty", "beginner");
    form.set("concepts", "made-up");
    await expect(saveTagsAction(form)).rejects.toThrow(
      /redirect:\/admin\/items\/7\?error=/,
    );
    expect(review.setTags).not.toHaveBeenCalled();
  });
});

describe("sources (P1-W3-S06)", () => {
  async function sourcesPage(): Promise<string> {
    const { default: Page } = await import("./sources/page");
    return renderToStaticMarkup(
      await Page({ searchParams: Promise.resolve({}) }),
    );
  }

  test("are a 404 without admin.review, page and action alike", async () => {
    current.mockResolvedValue(admin);
    can.mockResolvedValue(false);
    await expect(sourcesPage()).rejects.toThrow("notFound");
    const { switchMomentsAction } = await import("./sources/actions");
    const form = new FormData();
    form.set("sourceId", "3");
    form.set("switch", "off");
    await expect(switchMomentsAction(form)).rejects.toThrow("notFound");
    expect(sources.setMomentsSwitchedOff).not.toHaveBeenCalled();
  });

  test.each([
    ["no source id", { switch: "off" }],
    ["a malformed id", { sourceId: "3/../x", switch: "off" }],
    ["an unknown switch", { sourceId: "3", switch: "maybe" }],
  ])("the action refuses %s", async (_case, fields) => {
    current.mockResolvedValue(admin);
    can.mockResolvedValue(true);
    const { switchMomentsAction } = await import("./sources/actions");
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    await expect(switchMomentsAction(form)).rejects.toThrow("notFound");
    expect(sources.setMomentsSwitchedOff).not.toHaveBeenCalled();
  });

  test("the page says why moments are off and offers the switch only where it works", async () => {
    current.mockResolvedValue(admin);
    can.mockResolvedValue(true);
    const base = {
      rightsProfile: "full_text_internal",
      active: true,
      momentsSeeded: true,
      momentsSwitchedOff: false,
      momentsEnabled: true,
    };
    sources.list.mockResolvedValueOnce([
      { ...base, id: "1", name: "On" },
      {
        ...base,
        id: "2",
        name: "Switched",
        momentsSwitchedOff: true,
        momentsEnabled: false,
      },
      {
        ...base,
        id: "3",
        name: "Seeded off",
        momentsSeeded: false,
        momentsEnabled: false,
      },
      { ...base, id: "4", name: "Gone", active: false },
    ]);
    const html = await sourcesPage();
    expect(html).toContain("switched off here");
    expect(html).toContain("off in the seed file");
    expect(html).toContain("Switch moments back on");
    expect(html.match(/<form/g)).toHaveLength(2); // "On" and "Switched" only
  });

  test("an admin switches a source's moments off", async () => {
    current.mockResolvedValue(admin);
    can.mockResolvedValue(true);
    expect(await sourcesPage()).toContain("Switch moments off");
    sources.get.mockResolvedValue((await sources.list())[0]);
    const { switchMomentsAction } = await import("./sources/actions");
    const form = new FormData();
    form.set("sourceId", "3");
    form.set("switch", "off");
    await expect(switchMomentsAction(form)).rejects.toThrow(
      "redirect:/admin/sources?saved=1",
    );
    expect(sources.setMomentsSwitchedOff).toHaveBeenCalledWith(
      "3",
      true,
      "admin-1",
    );
  });
});
