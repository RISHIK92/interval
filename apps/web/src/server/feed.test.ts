import { afterEach, describe, expect, test, vi } from "vitest";
import { loadFeed } from "./feed";
import { log } from "./log";
import type { FeedCard, FeedReader, Preferences } from "./ports";

// The stored feed and ADR-0008's first visit, on a fake reader (ADR-0012).

const card = (id: string): FeedCard => ({
  kind: "moment",
  itemId: `item-${id}`,
  momentId: id,
  sectionTitle: `Section ${id}`,
  sectionNumber: 1,
  sectionCount: 1,
  estimatedMinutes: 3,
  articleTitle: "Article",
  author: null,
  sourceName: "Source",
  note: null,
  saved: false,
});

const NOW = new Date("2026-10-26T12:00:00Z");
const preferences: Preferences & { onboardedAt: Date } = {
  topics: ["databases", "backend"],
  level: "intermediate",
  breakLength: "3-8",
  onboardedAt: new Date(NOW.getTime() - 10_000), // a new guest, 10 s in
};
const now = () => NOW;

function reader(computedAfter: number, cards: FeedCard[] = [card("own")]) {
  let reads = 0;
  const read = vi.fn<FeedReader["read"]>(() => {
    reads += 1;
    return Promise.resolve(
      reads > computedAfter
        ? { computed: true, cards }
        : { computed: false, cards: [] },
    );
  });
  const starter = vi.fn<FeedReader["starter"]>(() =>
    Promise.resolve([card("starter")]),
  );
  return { read, starter } satisfies FeedReader;
}

describe("loadFeed", () => {
  test("a computed feed is served from one read, with no waiting", async () => {
    const feed = reader(0);
    const sleep = vi.fn(() => Promise.resolve());
    expect(
      await loadFeed({ feed, sleep, now }, "u1", preferences, "1-3", 50),
    ).toEqual({ cards: [card("own")] });
    expect(feed.read).toHaveBeenCalledExactlyOnceWith("u1", "1-3", 50);
    expect(sleep).not.toHaveBeenCalled();
  });

  test("a first visit waits for the recompute and then serves it", async () => {
    const feed = reader(2);
    const sleep = vi.fn(() => Promise.resolve());
    const result = await loadFeed(
      { feed, sleep, now },
      "u1",
      preferences,
      "3-8",
      50,
    );
    expect(result).toEqual({ cards: [card("own")] });
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(feed.starter).not.toHaveBeenCalled();
  });

  test("after about 3 seconds the starter feed for the first topic, level and chip is served", async () => {
    const feed = reader(Number.POSITIVE_INFINITY);
    const waited: number[] = [];
    const sleep = vi.fn((ms: number) => {
      waited.push(ms);
      return Promise.resolve();
    });
    const result = await loadFeed(
      { feed, sleep, now },
      "u1",
      preferences,
      "8-15",
      50,
    );
    expect(result).toEqual({ cards: [card("starter")] });
    expect(waited.reduce((a, b) => a + b, 0)).toBe(3000);
    expect(feed.starter).toHaveBeenCalledWith(
      "u1",
      "databases",
      "intermediate",
      "8-15",
      50,
    );
  });

  test("a computed but empty feed is not replaced by the starter", async () => {
    const feed = reader(0, []);
    const result = await loadFeed(
      { feed, sleep: () => Promise.resolve(), now },
      "u1",
      preferences,
      "3-8",
      50,
    );
    expect(result).toEqual({ cards: [] });
    expect(feed.starter).not.toHaveBeenCalled();
  });

  // ADR-0008 scopes the wait to a new guest: a feed that never lands (a recompute
  // stuck in the DLQ) must not cost every later page 3 seconds.
  test("long after onboarding a missing feed is replaced at once, without waiting", async () => {
    const feed = reader(Number.POSITIVE_INFINITY);
    const sleep = vi.fn(() => Promise.resolve());
    const settled = {
      ...preferences,
      onboardedAt: new Date(NOW.getTime() - 3_600_000),
    };
    const result = await loadFeed(
      { feed, sleep, now },
      "u1",
      settled,
      "3-8",
      50,
    );
    expect(result).toEqual({ cards: [card("starter")] });
    expect(sleep).not.toHaveBeenCalled();
    expect(feed.read).toHaveBeenCalledOnce();
  });
});

// OPS-2, P1-W6-S05: one "feed: served" line per feed page, which the AWS stack turns
// into the feed-latency metric. No user id: latency only.
describe("feed latency", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function ticking(stepMs: number) {
    let t = NOW.getTime();
    return () => {
      const at = new Date(t);
      t += stepMs;
      return at;
    };
  }

  test("a stored feed logs how long it took", async () => {
    const info = vi.spyOn(log, "info").mockImplementation(() => undefined);
    const feed = reader(0);
    await loadFeed({ feed, now: ticking(40) }, "u1", preferences, "1-3", 50);
    expect(info).toHaveBeenCalledExactlyOnceWith("feed: served", {
      duration_ms: 40,
      from: "user",
    });
  });

  test("the starter fallback says so, its wait included", async () => {
    const info = vi.spyOn(log, "info").mockImplementation(() => undefined);
    const feed = reader(Number.POSITIVE_INFINITY);
    const sleep = vi.fn(() => Promise.resolve());
    await loadFeed(
      { feed, sleep, now: ticking(500) },
      "u1",
      preferences,
      "1-3",
      50,
    );
    expect(info).toHaveBeenCalledExactlyOnceWith("feed: served", {
      duration_ms: 500,
      from: "starter",
    });
  });

  test("no topic to start from serves nothing, logged as empty", async () => {
    const info = vi.spyOn(log, "info").mockImplementation(() => undefined);
    const feed = reader(Number.POSITIVE_INFINITY);
    await loadFeed(
      { feed, sleep: () => Promise.resolve(), now: ticking(10) },
      "u1",
      { ...preferences, topics: [] },
      "1-3",
      50,
    );
    expect(info).toHaveBeenCalledExactlyOnceWith("feed: served", {
      duration_ms: 10,
      from: "empty",
    });
  });
});
