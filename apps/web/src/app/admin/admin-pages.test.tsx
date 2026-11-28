import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import type {
  Actor,
  AdminReview,
  RankingInspection,
  ReviewItem,
} from "../../server/ports";

// ING-6, Q-P1-29, P1-W3-S05: the review pages and actions exist only for admin.review.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const can = vi.fn<(userId: string, capability: string) => Promise<boolean>>();
const review = {
  recent: vi.fn<AdminReview["recent"]>(),
  item: vi.fn<AdminReview["item"]>(),
  activeConcepts: vi.fn<AdminReview["activeConcepts"]>(() =>
    Promise.resolve(["write-ahead-log"]),
  ),
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
      },
    ]),
  ),
};
const ranking = {
  entries: vi.fn<RankingInspection["entries"]>(() => Promise.resolve([])),
  settings: vi.fn<RankingInspection["settings"]>(() =>
    Promise.resolve([
      { key: "weight.freshness", value: 0.5, note: "exp(-age / half-life)" },
    ]),
  ),
  setSetting: vi.fn<RankingInspection["setSetting"]>(() =>
    Promise.resolve("changed" as const),
  ),
};
vi.mock("../../server/container", () => ({
  rankingInspection: () => ranking,
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
  modelTags: { difficulty: "intermediate", concepts: ["write-ahead-log"] },
  tagOverride: { difficulty: "advanced", concepts: [] },
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
    const { saveTagsAction } = await import("./items/[id]/actions");
    const form = new FormData();
    form.set("itemId", "7");
    await expect(saveTagsAction(form)).rejects.toThrow("notFound");
    expect(review.setTags).not.toHaveBeenCalled();
  });
});

describe("for an admin", () => {
  // ADR-0058: the whole article's tags and override; its sections for reference,
  // with no moments or boundaries to edit.
  test("the item shows its tags, its override and its sections", async () => {
    current.mockResolvedValue(admin);
    can.mockResolvedValue(true);
    review.item.mockResolvedValue(item);
    const html = await itemPage({ saved: "1" });
    expect(can).toHaveBeenCalledWith("admin-1", "admin.review");
    expect(html).toContain("Model: intermediate · write-ahead-log");
    expect(html).toContain("Override: advanced · no concepts");
    expect(html).toContain("Setup · 400 words");
    expect(html).not.toContain('name="boundary"');
    expect(html).not.toContain('name="heading"');
    expect(html).not.toContain("Moments");
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

  test("saving the article's tags comes back to the page", async () => {
    current.mockResolvedValue(admin);
    can.mockResolvedValue(true);
    review.item.mockResolvedValue(item);
    const { saveTagsAction } = await import("./items/[id]/actions");
    const form = new FormData();
    form.set("itemId", "7");
    form.set("difficulty", "beginner");
    form.set("concepts", "write-ahead-log");
    await expect(saveTagsAction(form)).rejects.toThrow(
      "redirect:/admin/items/7?saved=1",
    );
    expect(review.setTags).toHaveBeenCalledWith(
      "7",
      { difficulty: "beginner", concepts: ["write-ahead-log"] },
      "admin-1",
    );
  });

  test("a refused tag edit comes back with the reason", async () => {
    current.mockResolvedValue(admin);
    can.mockResolvedValue(true);
    review.item.mockResolvedValue(item);
    const { saveTagsAction } = await import("./items/[id]/actions");
    const form = new FormData();
    form.set("itemId", "7");
    form.set("difficulty", "beginner");
    form.set("concepts", "made-up");
    await expect(saveTagsAction(form)).rejects.toThrow(
      /redirect:\/admin\/items\/7\?error=/,
    );
    expect(review.setTags).not.toHaveBeenCalled();
  });
});

describe("sources", () => {
  async function sourcesPage(): Promise<string> {
    const { default: Page } = await import("./sources/page");
    return renderToStaticMarkup(await Page());
  }

  test("are a 404 without admin.review", async () => {
    current.mockResolvedValue(admin);
    can.mockResolvedValue(false);
    await expect(sourcesPage()).rejects.toThrow("notFound");
    expect(sources.list).not.toHaveBeenCalled();
  });

  // ADR-0058: the moments switch is gone; the page lists rights only.
  test("the page lists each source's rights, with no switch", async () => {
    current.mockResolvedValue(admin);
    can.mockResolvedValue(true);
    sources.list.mockResolvedValueOnce([
      {
        id: "1",
        name: "On",
        rightsProfile: "full_text_internal",
        active: true,
      },
      { id: "4", name: "Gone", rightsProfile: "metadata_only", active: false },
    ]);
    const html = await sourcesPage();
    expect(html).toContain("full_text_internal");
    expect(html.replace(/<[^>]+>/g, "")).toContain(
      "Gone (not in the seed file)",
    );
    expect(html).not.toContain("<form");
    expect(html).not.toContain("Moments");
  });
});

describe("ranking (P1-W6-S01)", () => {
  async function rankingPage(
    params: Record<string, string> = {},
  ): Promise<string> {
    const { default: Page } = await import("./ranking/page");
    return renderToStaticMarkup(
      await Page({ searchParams: Promise.resolve(params) }),
    );
  }

  function settingForm(fields: Record<string, string>): FormData {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    return form;
  }

  test("is a 404 without admin.review, page and action alike", async () => {
    current.mockResolvedValue(admin);
    can.mockResolvedValue(false);
    await expect(rankingPage()).rejects.toThrow("notFound");
    const { saveRankingSettingAction } = await import("./ranking/actions");
    await expect(
      saveRankingSettingAction(
        settingForm({ key: "weight.freshness", value: "2" }),
      ),
    ).rejects.toThrow("notFound");
    expect(ranking.setSetting).not.toHaveBeenCalled();
    expect(ranking.entries).not.toHaveBeenCalled();
  });

  test("shows the admin's own feed, each score broken down by rule", async () => {
    current.mockResolvedValue(admin);
    can.mockResolvedValue(true);
    ranking.settings.mockResolvedValueOnce([
      { key: "weight.freshness", value: 0.5, note: "exp(-age / half-life)" },
      { key: "weight.quality", value: 0.4, note: "the source's quality" },
    ]);
    ranking.entries.mockResolvedValueOnce([
      {
        rank: 1,
        articleTitle: "Consensus in practice",
        sourceName: "Blog",
        topSignal: "freshness",
        explored: { kind: "topic", arm: "backend" },
        breakdown: {
          values: { freshness: 0.8, quality: 0.5 },
          weights: { freshness: 0.5, quality: 0.4 },
          weighted: { freshness: 0.4, quality: 0.2 },
          penalty: 0.1,
        },
      },
      {
        rank: 2,
        articleTitle: "Old entry",
        sourceName: "Blog",
        topSignal: "quality",
        explored: null,
        breakdown: null,
      },
    ]);
    // ADR-0058: one feed; an old link's chip is ignored.
    const html = await rankingPage({ chip: "8-15" });
    expect(ranking.entries).toHaveBeenCalledWith("admin-1");
    expect(html).toContain("Consensus in practice");
    expect(html).not.toContain('aria-label="Break length"');
    expect(html).toContain("0.80 × 0.50 = 0.40"); // freshness: value, weight, part
    expect(html).toContain("0.50 × 0.40 = 0.20"); // quality
    expect(html).toContain("−0.10"); // the penalty
    expect(html).toContain("<td>0.50</td>"); // the total: 0.40 + 0.20 - 0.10
    expect(html).toContain("explored: topic backend");
    expect(html).toContain("No breakdown yet");
    // Every row has as many cells as the header, with or without a breakdown.
    const cells = (row: string) =>
      (row.match(/<t[dh][ >]/g) ?? []).length +
      [...row.matchAll(/colSpan="(\d+)"/g)].reduce(
        (sum, m) => sum + Number(m[1]) - 1,
        0,
      );
    const rows = html.match(/<tr>.*?<\/tr>/g) ?? [];
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map(cells)).size).toBe(1);
    expect(html).toContain('name="key" value="weight.freshness"');
  });

  test("saving a setting changes it, recomputes the admin's feed and comes back", async () => {
    current.mockResolvedValue(admin);
    can.mockResolvedValue(true);
    const { saveRankingSettingAction } = await import("./ranking/actions");
    await expect(
      saveRankingSettingAction(
        settingForm({ key: "weight.freshness", value: "2" }),
      ),
    ).rejects.toThrow("redirect:/admin/ranking?saved=1");
    expect(await rankingPage({ saved: "same" })).toContain("No change");
    expect(ranking.setSetting).toHaveBeenCalledExactlyOnceWith(
      "weight.freshness",
      2,
    );
    expect(enqueue).toHaveBeenCalledExactlyOnceWith(
      "recompute_feed",
      { user_id: "admin-1" },
      expect.anything(),
    );
  });

  test("a refused value comes back with the reason, as fixed text", async () => {
    current.mockResolvedValue(admin);
    can.mockResolvedValue(true);
    const { saveRankingSettingAction } = await import("./ranking/actions");
    await expect(
      saveRankingSettingAction(settingForm({ key: "mmr.lambda", value: "7" })),
    ).rejects.toThrow("redirect:/admin/ranking?error=out-of-range");
    expect(ranking.setSetting).not.toHaveBeenCalled();
    const html = await rankingPage({ error: "<b>made up</b>" });
    expect(html).not.toContain("made up");
    expect(await rankingPage({ error: "out-of-range" })).toContain(
      "outside its allowed range",
    );
  });
});
