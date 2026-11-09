import { expect, test } from "vitest";
import { FeedResponse } from "./index.js";

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
