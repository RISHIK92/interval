import { describe, expect, test } from "vitest";
import { FeedResponse, ReaderResponse, sentenceAt } from "./index";

// P4-W20-S01, ADR-0058: a feed answer of article cards, each with its state, parses;
// a section card or a time chip no longer does.
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
  estimatedMinutes: 12,
  state: "continue_reading",
};

test("a feed of article cards parses", () => {
  const feed = {
    cards: [card, { ...card, estimatedMinutes: null, state: "unread" }],
  };
  expect(FeedResponse.parse(feed)).toEqual(feed);
  expect(
    FeedResponse.safeParse({ cards: [{ ...card, state: "halfway" }] }).success,
  ).toBe(false);
  // A field the server no longer sends is dropped, never trusted.
  expect(
    FeedResponse.parse({ chip: "3-8", cards: [{ ...card, momentId: "9" }] }),
  ).toEqual({ cards: [card] });
});

// ADR-0058: the app's reader shows an article, its state and its notes; it measures
// the whole page to complete it, never a section.
test("a reader answer is an article", () => {
  const reader = {
    url: "https://example.com/raft",
    inApp: true,
    title: "Raft",
    domain: "example.com",
    saved: false,
    state: "unread",
    note: null,
    sectionNotes: [{ sectionTitle: "Leader election", body: "terms" }],
    testable: true,
    listen: false,
    measure: { minutes: 12 },
  };
  expect(ReaderResponse.parse(reader)).toEqual(reader);
  expect(
    ReaderResponse.safeParse({ ...reader, measure: { minutes: 0 } }).success,
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
