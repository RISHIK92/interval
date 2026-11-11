import { describe, expect, test } from "vitest";
import { FeedResponse, sentenceAt } from "./index";

// P4-W20-S01: a feed answer with a moment and an article card parses; anything off isn't.
const card = {
  itemId: "5",
  articleTitle: "Raft",
  author: null,
  sourceName: "A blog",
  reasons: { text: "On your path", kinds: ["goal_match"] },
  projectNote: null,
  saved: false,
  frameable: true,
  topic: "distributed-systems",
  difficulty: "intermediate",
};

test("a feed with both kinds of card parses", () => {
  const feed = {
    chip: "3-8",
    cards: [
      {
        ...card,
        kind: "moment",
        momentId: "9",
        sectionTitle: "Leader election",
        sectionNumber: 2,
        sectionCount: 5,
        estimatedMinutes: 6,
      },
      { ...card, kind: "article", estimatedMinutes: null },
    ],
  };
  expect(FeedResponse.parse(feed)).toEqual(feed);
  expect(FeedResponse.safeParse({ ...feed, chip: "2-4" }).success).toBe(false);
  expect(
    FeedResponse.safeParse({ ...feed, cards: [{ ...card, kind: "video" }] })
      .success,
  ).toBe(false);
});

// P4-W23-S03: the sentence being said, for both players' captions.
describe("sentenceAt", () => {
  const w = (text: string, start: number) => ({
    text,
    start,
    end: start + 0.4,
  });
  const captions = [
    w("Raft", 0),
    w("elects", 0.5),
    w("leaders.", 1),
    w("Then", 2),
    w("it", 2.5),
    w("replicates!", 3),
  ];
  test("the word being said in its sentence", () => {
    expect(sentenceAt(captions, 0.6)).toEqual({
      words: captions.slice(0, 3),
      current: 1,
    });
    expect(sentenceAt(captions, 2.6).current).toBe(1);
    expect(sentenceAt(captions, 2.6).words[0]?.text).toBe("Then");
  });
  test("between words, before the start and after the end", () => {
    // The word just said stays marked through the gap.
    expect(sentenceAt(captions, 0.45)).toEqual({
      words: captions.slice(0, 3),
      current: 0,
    });
    expect(sentenceAt(captions, -1).current).toBe(-1);
    // After a sentence's last word, the next one is up.
    expect(sentenceAt(captions, 1.7).words[0]?.text).toBe("Then");
    expect(sentenceAt(captions, 99)).toEqual({
      words: captions.slice(3),
      current: 2,
    });
    expect(sentenceAt([], 1)).toEqual({ words: [], current: -1 });
  });
});
