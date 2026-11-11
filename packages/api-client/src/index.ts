import { z } from "zod";

// ARCH-3, P4-W20-S01: the shapes the site's JSON API answers with, parsed by the native
// app; the web routes' tests check their output against the same schemas, so the two
// can't drift.

const Reasons = z
  .object({ text: z.string(), kinds: z.array(z.string()) })
  .nullable();

const CardBase = z.object({
  itemId: z.string(),
  articleTitle: z.string(),
  author: z.string().nullable(),
  sourceName: z.string(),
  // ADR-0027: the card's one explanation.
  reasons: Reasons,
  // AI-3: the notes model's line, always labeled as AI where it's shown.
  projectNote: z
    .object({ text: z.string(), repositories: z.array(z.string()) })
    .nullable(),
  saved: z.boolean(),
  frameable: z.boolean(),
  topic: z.string().nullable(),
  difficulty: z.string().nullable(),
});

export const FeedCard = z.discriminatedUnion("kind", [
  CardBase.extend({
    kind: z.literal("moment"),
    momentId: z.string(),
    sectionTitle: z.string(),
    sectionNumber: z.number().int(),
    sectionCount: z.number().int(),
    estimatedMinutes: z.number(),
  }),
  CardBase.extend({
    kind: z.literal("article"),
    estimatedMinutes: z.number().nullable(),
  }),
]);
export type FeedCard = z.infer<typeof FeedCard>;

export const CHIPS = ["1-3", "3-8", "8-15"] as const;
export type Chip = (typeof CHIPS)[number];

// A first visit waits for its feed or gets the starter feed (ADR-0008), as the PWA's;
// an account not yet onboarded gets 409 instead (onboarding is on the web).
export const FeedResponse = z.object({
  chip: z.enum(CHIPS),
  cards: z.array(FeedCard),
});
export type FeedResponse = z.infer<typeof FeedResponse>;

// The card controls (§5C, Q-P1-15), as the PWA's card menu has them.
export const CARD_CONTROLS = [
  "more_like_this",
  "less_like_this",
  "not_interested",
  "hide_source",
  "save",
  "unsave",
  "undo_not_interested",
] as const;
export type CardControl = (typeof CARD_CONTROLS)[number];

// A 409 from the feed: what the account must finish on the web first.
export const FeedSetup = z.object({
  setup: z.enum(["onboarding", "username"]),
});
export type FeedSetup = z.infer<typeof FeedSetup>;

// P4-W20-S02 (ADR-0018, §3.2): what the app's reader shows around the publisher's live
// page: titles, the user's save and note, never the page's text. `url` opens in the
// WebView when `inApp`; anything not https goes to the browser.
// P4-W20-S03 (§5D): where a section starts in the publisher's page: an element's id
// (an anchor link) or a heading's text (a text fragment).
export const Marker = z.union([
  z.object({ id: z.string().min(1) }),
  z.object({ text: z.string().min(1) }),
]);
export type Marker = z.infer<typeof Marker>;

export const ReaderResponse = z.object({
  url: z.string(),
  inApp: z.boolean(),
  title: z.string(),
  domain: z.string(),
  saved: z.boolean(),
  // The section reached; null when the link fell back to the article's page.
  reached: z.string().nullable(),
  nextMomentId: z.string().nullable(),
  note: z.string().nullable(),
  // Test 60s has a live question on what's shown (P4-W21-S01).
  testable: z.boolean(),
  // A concept of what's shown has a voiced AI explainer: Listen (P4-W23-S02).
  listen: z.boolean(),
  // What the reader measures to finish the section by itself: its start, the next
  // section's start (null: the page's end, it is the last) and its minutes. Null when
  // there is no section to measure (an article or page-top link).
  measure: z
    .object({
      start: Marker,
      end: Marker.nullable(),
      minutes: z.number().int().positive(),
    })
    .nullable(),
});
export type ReaderResponse = z.infer<typeof ReaderResponse>;
// As the web's notes (P2-W7-S03).
export const NOTE_MAX = 2000;

// P4-W21-S01 (§6.3, Q-P2-14): the solo games, the daily challenge and Test 60s. The
// server holds the clock and the key: a question comes without its answer.
const ID = z.string().min(1);
export const GAMES = ["sprint", "estimation", "daily"] as const;
export type Game = (typeof GAMES)[number];
export const Streak = z.object({
  days: z.number().int().nonnegative(),
  freezes: z.number().int().nonnegative(),
});
export const PlayResponse = z.object({
  // What the plan includes (OPS-3).
  games: z.object({
    sprint: z.boolean(),
    estimation: z.boolean(),
    daily: z.boolean(),
  }),
  // P4-W21-S02 (Q-P4-05): live 1v1. offered: the game server is set up (else "Coming
  // later", as the web's Play); each mode: the plan has it.
  live: z.object({
    offered: z.boolean(),
    sprint: z.boolean(),
    fastest_finger: z.boolean(),
  }),
  daily: z.object({
    today: z.union([
      z.enum(["none", "open"]),
      z.object({ attemptId: ID, finished: z.boolean(), points: z.number() }),
    ]),
    streak: Streak,
  }),
});
export type PlayResponse = z.infer<typeof PlayResponse>;

export const QuizStarted = z.object({ attemptId: ID });

export const QuizQuestion = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("choice"),
    questionId: ID,
    stem: z.string(),
    aiDrafted: z.boolean(),
    options: z.array(z.string()).min(2),
  }),
  z.object({
    kind: z.literal("estimate"),
    questionId: ID,
    stem: z.string(),
    aiDrafted: z.boolean(),
    unit: z.string(),
  }),
]);
export type QuizQuestion = z.infer<typeof QuizQuestion>;
export const QUIZ_KINDS = [
  "test",
  "sprint",
  "estimation",
  "daily",
  "review",
  "checkpoint",
] as const;
export const QuizView = z.object({
  title: z.string(),
  kind: z.enum(QUIZ_KINDS),
  // The server's clock; null when the attempt has none.
  secondsLeft: z.number().int().nonnegative().nullable(),
  // Null: over (time, or no more questions).
  question: QuizQuestion.nullable(),
});
export type QuizView = z.infer<typeof QuizView>;

// Where an estimate's answer comes from (AI-3): a quoted page, or a section to read.
export const EstimateSource = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("page"),
    url: z.string(),
    title: z.string(),
    citation: z.string(),
  }),
  z.object({
    kind: z.literal("section"),
    itemId: ID,
    momentId: ID,
    sectionTitle: z.string(),
  }),
]);
export const AnswerResult = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("choice"),
    correct: z.boolean(),
    correctOption: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("estimate"),
    answer: z.number(),
    unit: z.string(),
    score: z.number().min(0).max(1),
    source: EstimateSource.nullable(),
  }),
]);
export type AnswerResult = z.infer<typeof AnswerResult>;
export const AnswerBody = z.union([
  z.object({ questionId: ID, chosen: z.number().int().min(0).max(3) }),
  z.object({ questionId: ID, guess: z.number().positive() }),
]);
export type AnswerBody = z.infer<typeof AnswerBody>;

export const QuizResults = z.object({
  kind: z.enum(QUIZ_KINDS),
  title: z.string(),
  answered: z.number().int().nonnegative(),
  correct: z.number().int().nonnegative(),
  // A game's score (a sprint's: its right answers); null for Test 60s.
  points: z.number().nullable(),
  daily: z.object({ shareId: ID, streak: Streak }).nullable(),
  // Sections to read again (§6.1).
  missed: z.array(
    z.object({ itemId: ID, momentId: ID, sectionTitle: z.string() }),
  ),
});
export type QuizResults = z.infer<typeof QuizResults>;

// P4-W21-S03 (§6.7): a board as the web's boards page shows it, with its labels.
const BoardRow = z.object({
  id: ID,
  name: z.string(),
  score: z.string(),
  rank: z.number().int().positive(),
});
export const BoardResponse = z.object({
  game: z.enum(["daily", "sprint", "estimation", "season"]),
  scope: z.enum(["global", "country", "university", "friends", "universities"]),
  period: z.enum(["current", "previous"]),
  // Chips: label by key, in order (a guest's scopes are only global and universities).
  games: z.array(z.object({ key: z.string(), label: z.string() })),
  scopes: z.array(z.object({ key: z.string(), label: z.string() })),
  periods: z.array(z.object({ key: z.string(), label: z.string() })),
  body: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("rows"),
      rows: z.array(BoardRow),
      mine: z.string().nullable(),
      mark: z.enum(["You", "Yours"]),
      unit: z.string(),
      pinned: BoardRow.extend({ note: z.string() }).nullable(),
      missing: z
        .enum(["not_yet", "set_university", "university_absent"])
        .nullable(),
    }),
    z.object({
      kind: z.literal("unset"),
      what: z.enum(["country", "university", "follows"]),
    }),
  ]),
});
export type BoardResponse = z.infer<typeof BoardResponse>;

// P4-W21-S03 (§5F): topic paths in the app: the list, a path's sections with their
// readings and checkpoint. Editing a path stays on the web (owner, 2026-11-09).
const PathMine = z.enum(["active", "paused"]).nullable();
export const PathsResponse = z.object({
  paths: z.array(
    z.object({
      pathId: ID,
      name: z.string(),
      why: z.string(),
      sections: z.number().int().nonnegative(),
      readings: z.number().int().nonnegative(),
      minutes: z.number().nonnegative(),
      mine: PathMine,
      retired: z.boolean(),
    }),
  ),
});
export type PathsResponse = z.infer<typeof PathsResponse>;
export const PathResponse = z.object({
  pathId: ID,
  name: z.string(),
  why: z.string(),
  retired: z.boolean(),
  mine: PathMine,
  sections: z.array(
    z.object({
      sectionId: ID,
      concepts: z.array(z.string()),
      open: z.boolean(),
      checkpoint: z.enum([
        "locked",
        "reading",
        "ready",
        "no_questions",
        "passed",
        "skipped",
      ]),
      skipped: z.boolean(),
      // Its checkpoint gates the sections after it (a locked one names it).
      holdsBack: z.boolean(),
      mastered: z.boolean(),
      size: z.number().int().nonnegative(),
      passMark: z.number().int().nonnegative(),
      readings: z.array(
        z.object({
          itemId: ID,
          momentId: ID,
          sectionTitle: z.string(),
          articleTitle: z.string(),
          sourceName: z.string(),
          minutes: z.number().nonnegative(),
          linkBroken: z.boolean(),
          finished: z.boolean(),
        }),
      ),
    }),
  ),
});
export type PathResponse = z.infer<typeof PathResponse>;

// P4-W21-S04 (§5F, DB-6): the user's own PDF books, read in sessions in the app.
export const BooksResponse = z.object({
  books: z.array(
    z.object({
      bookId: ID,
      title: z.string(),
      done: z.number().int().nonnegative(),
      of: z.number().int().nonnegative(),
      first: ID,
      started: z.boolean(),
      // Where it opens; null once every session is finished.
      next: ID.nullable(),
    }),
  ),
});
export type BooksResponse = z.infer<typeof BooksResponse>;
export const BookReading = z.object({
  bookId: ID,
  bookTitle: z.string(),
  chapterTitle: z.string(),
  sessionId: ID,
  title: z.string(),
  minutes: z.number().nonnegative(),
  firstPage: z.number().int().positive(),
  lastPage: z.number().int().positive(),
  finished: z.boolean(),
  // Where the user left off in this session, 0 to 1.
  fraction: z.number().min(0).max(1).nullable(),
  previous: ID.nullable(),
  next: ID.nullable(),
  place: z.number().int().positive(),
  of: z.number().int().positive(),
});
export type BookReading = z.infer<typeof BookReading>;
export const BookFinished = z.object({
  // A chapter's last session: its checkpoint is being made.
  chapterDone: ID.nullable(),
});
export const ChapterEnd = z.object({
  bookId: ID,
  bookTitle: z.string(),
  chapterId: ID,
  title: z.string(),
  finished: z.boolean(),
  state: z.enum(["none", "preparing", "ready", "failed"]),
  stuck: z.boolean(),
  failure: z.string().nullable(),
  size: z.number().int().nonnegative(),
  passMark: z.number().int().nonnegative(),
  concepts: z.array(z.string()),
  last: z
    .object({
      passed: z.boolean(),
      correct: z.number().int().nonnegative(),
      size: z.number().int().nonnegative(),
    })
    .nullable(),
  next: z.object({ sessionId: ID, title: z.string() }).nullable(),
});
export type ChapterEnd = z.infer<typeof ChapterEnd>;
export * from "./place";

// TTS-3 (P4-W23-S03): one word of the explainer as written, and when it's said.
export const Caption = z.object({
  text: z.string(),
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
});
export type Caption = z.infer<typeof Caption>;

// P4-W23-S03 (owner, 2026-11-11): the sentence being said, for both players' captions.
// `current` is the last word begun, so the highlight holds through the gaps between
// words; -1 before the sentence's first. After the last word, the last sentence.
export function sentenceAt(
  captions: Caption[],
  seconds: number,
): { words: Caption[]; current: number } {
  const sentences: Caption[][] = [[]];
  for (const caption of captions) {
    sentences.at(-1)?.push(caption);
    if (/[.!?]["')\]]*$/.test(caption.text)) sentences.push([]);
  }
  const whole = sentences.filter((s) => s.length > 0);
  const words =
    whole.find((s) => seconds < (s.at(-1)?.end ?? 0)) ?? whole.at(-1) ?? [];
  let current = -1;
  for (const [i, w] of words.entries()) if (w.start <= seconds) current = i;
  return { words, current };
}

// P4-W23-S01 (§5G, §5I): the audio queue and its saved positions, shared by the PWA and
// the native player. Every explainer is AI (AI-1) and cites its sections (AI-3).
export const ListenExplainer = z.object({
  explainerId: ID,
  conceptId: ID,
  concept: z.string(),
  // The HLS playlist, a same-origin path under /media/.
  src: z.string().startsWith("/media/"),
  durationSeconds: z.number().positive(),
  positionSeconds: z.number().nonnegative(),
  sources: z.array(z.object({ title: z.string(), href: z.url() })),
  // TTS-3 (P4-W23-S03): each word as written, with when it's said.
  captions: z.array(Caption),
});
export type ListenExplainer = z.infer<typeof ListenExplainer>;
export const ListenResponse = z.object({
  queue: z.array(ListenExplainer),
  // Wireframe 07: a connected concept, offered once the queue is done; never autoplayed.
  upNext: ListenExplainer.nullable(),
});
export type ListenResponse = z.infer<typeof ListenResponse>;
export const ListenQueued = z.object({ first: ID });
