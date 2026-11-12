// Ports (ADR-0012): what server logic and pages depend on. Adapters implement them;
// container.ts wires them. Nothing outside adapters/ imports kysely or pg.

import type {
  BreakLength,
  Capability,
  Difficulty,
  FeedbackKind,
  FlagReason,
  LearnerState,
  LearningGoal,
  QuestionStatus,
  ReviewReason,
  Topic,
} from "@interval/db";
import type {
  Caption,
  ListenResponse,
  PushPreferences,
} from "@interval/api-client";
import type { MessageName, Messages } from "@interval/db/messages";
import type { Envelope } from "@interval/events";
import type { Interface, Problem, ResultLine, Scenario } from "@interval/lld";

// The reasons a card explanation can state (ADR-0026/0027), as the worker names them.
export const REASON_KINDS = [
  "topic_match",
  "goal_match",
  "project_match",
  "level_fit",
  "time_fit",
  "quality",
  "freshness",
  "explore",
] as const;
export type ReasonKind = (typeof REASON_KINDS)[number];
export function isReasonKind(kind: string): kind is ReasonKind {
  return (REASON_KINDS as readonly string[]).includes(kind);
}

// What a card may show (§3.2, ING-2): no summary or body text. A moment, or in the
// 8–15 chip a whole article (Q-P1-16, P1-W4-S05b).
type CardBase = {
  itemId: string;
  articleTitle: string;
  author: string | null;
  sourceName: string;
  // ADR-0027: the card's one explanation, and the reason it states for "a reason is
  // wrong" (none for a neutral phrase); null on an entry from before ADR-0026.
  reasons: { text: string; kinds: ReasonKind[] } | null;
  // P2-W12-S05 (§5B, AI-3): the notes model's line on why it matters to the user's
  // own repositories; only ever in that user's feed.
  projectNote: { text: string; repositories: string[] } | null;
  saved: boolean; // the user saved its article (P1-W5-S04)
  // ADR-0018: the publisher's page allows Interval's in-app reader to frame it
  // (false while unknown).
  frameable: boolean;
  topic: Topic | null; // its source's first known topic, for the picture (ADR-0019)
  // ADR-0027: its difficulty label, as the ranking saw it (an admin's tag first).
  difficulty: Difficulty | null;
};
export type MomentFeedCard = CardBase & {
  kind: "moment";
  momentId: string;
  sectionTitle: string;
  sectionNumber: number;
  sectionCount: number;
  estimatedMinutes: number;
};
export type ArticleFeedCard = CardBase & {
  kind: "article";
  estimatedMinutes: number | null; // null: no body text to count (Q-P1-39)
};
export type FeedCard = MomentFeedCard | ArticleFeedCard;

// CACHE-1, P1-W4-S04: the worker stores each user's ranked feed; this only reads it.
export interface FeedReader {
  // One query: one time chip's stored cards in rank order (Q-P1-16), and whether the
  // feed was ever computed (a first visit waits for it, ADR-0008). Empty and computed
  // is a real, empty feed.
  read(
    userId: string,
    chip: BreakLength,
    limit: number,
  ): Promise<{ computed: boolean; cards: FeedCard[] }>;
  // A new guest's feed while their own is computed (ADR-0008). Both leave out the
  // user's Not interested items and hidden sources at once (P1-W4-S07).
  starter(
    userId: string,
    topic: Topic,
    level: Difficulty,
    chip: BreakLength,
    limit: number,
  ): Promise<FeedCard[]>;
}

// What the feed inferred from a user's feedback (PER-1's inferred layer, §5A).
export type Inferred = {
  more: { itemId: string; title: string }[];
  less: { itemId: string; title: string }[];
  // From the user_avoided_concept view; names aren't unique, slugs are.
  avoidedConcepts: { slug: string; name: string }[];
};

// Where a card's link goes (§3.2, P1-W5-S01): looked up by id, never taken from
// input, so /out can't send anyone elsewhere. A moment goes to its section while its
// source allows moments (ING-2); otherwise, and for a whole article, to the page.
export type OutboundLink = {
  url: string;
  linkType: "anchor" | "text_fragment" | "page_top" | "article";
};
// What the in-app reader shows around the publisher's framed page (ADR-0018): titles,
// the user's note and save, never the page's text (§3.2, ING-2).
export type ReaderPage = {
  link: OutboundLink; // as resolve() gives it
  frameable: boolean; // false while unknown
  articleTitle: string;
  sectionTitle: string | null; // null when the link is the article's page
  sourceName: string;
  // The entry's explanation in the user's feed (ADR-0027), if it is in it.
  reasons: string | null;
  saved: boolean;
  nextMomentId: string | null; // the section after the one reached, by order
  // P4-W20-S03: what the app's reader measures: the reached section's minutes and
  // where the next section starts (its link). Null with no section reached / no next.
  estimatedMinutes: number | null;
  nextLink: string | null;
};
export interface OutboundLinks {
  resolve(
    itemId: string,
    momentId: string | null,
  ): Promise<OutboundLink | null>;
  // Null when resolve() finds nothing.
  reader(
    userId: string,
    itemId: string,
    momentId: string | null,
  ): Promise<ReaderPage | null>;
}

// Finishing sections and articles (§5D, C-22, Q-P1-35, P1-W5-S02). Each finish
// returns whether it changed anything: the first is kept, and only it counts.
// auto: the app's reader saw the section read through (P4-W20-S03).
export type FinishMethod = "return_prompt" | "mark_done" | "auto";
export type ConceptsByTopic = {
  topic: Topic;
  // due: its FSRS card has come due (P2-W9-S04), shown beside the state.
  concepts: { slug: string; name: string; state: LearnerState; due: boolean }[];
};
export interface Progress {
  // The moment must belong to the item, as the panel and prompt name it.
  finishMoment(
    userId: string,
    itemId: string,
    momentId: string,
    method: FinishMethod,
  ): Promise<boolean>;
  finishArticle(
    userId: string,
    itemId: string,
    method: FinishMethod,
  ): Promise<boolean>;
  // For the Now reading panel; null for ids that name nothing (a moment of another
  // article included) and for a section whose source no longer allows moments (ING-2).
  describe(
    itemId: string,
    momentId: string | null,
  ): Promise<{ articleTitle: string; sectionTitle: string | null } | null>;
  // Q-P2-04, P2-W7-S02: the concepts the user has evidence for (PER-2), grouped by
  // topic, each with its state (P2-W9-S03); the most recently updated topic and
  // concept first.
  concepts(userId: string): Promise<ConceptsByTopic[]>;
  // The section after this one, by order; null after the last.
  nextMoment(
    itemId: string,
    momentId: string,
  ): Promise<{ momentId: string; title: string; frameable: boolean } | null>;
  // P1-W5-S03 (Q-P1-35): the article, once every one of its sections is finished.
  finishArticleIfComplete(
    userId: string,
    itemId: string,
    method: FinishMethod,
  ): Promise<boolean>;
  // A section opened through /out: read, for continue cards, but not finished
  // (owner, 2026-10-26). The first open is kept; a moment of another item is ignored.
  recordOpen(userId: string, itemId: string, momentId: string): Promise<void>;
  // Q-P1-40: articles with a section read (opened or finished) and one unread, the
  // last read within 30 days of `now`, not finished, not dismissed since that read;
  // most recent first.
  continueCards(
    userId: string,
    now: Date,
    limit: number,
  ): Promise<ContinueCard[]>;
  dismissContinue(userId: string, itemId: string): Promise<void>;
  // Exploration outcomes (REC-4, P1-W4-S09): a feed card's first open counts as shown
  // for the arm that placed it, if any; the user's first finish of that article then
  // counts as finished. Each once per user and article.
  countExploreOpen(
    userId: string,
    chip: BreakLength,
    itemId: string,
    momentId: string | null,
  ): Promise<void>;
  countExploreFinish(userId: string, itemId: string): Promise<void>;
}

export type ContinueCard = {
  itemId: string;
  momentId: string; // the next unread section, in order
  sectionTitle: string;
  sectionNumber: number;
  sectionCount: number;
  articleTitle: string;
  frameable: boolean; // ADR-0018, as on feed cards
};

// Saves and history (§5I, P1-W5-S04), for the Library (W5-S05): ids, titles and
// sources only, never an article's text.
// How far the user read a Library item, for its link (owner, 2026-10-26): continue at
// the next section, open it fresh, or read it again; in the reader when framable.
type LibraryProgress = {
  finishedSections: number;
  totalSections: number;
  finished: boolean; // every section, or the whole article
  nextMomentId: string | null; // the first section by order not yet finished
  frameable: boolean; // ADR-0018 (false while unknown)
  linkBroken: boolean; // the weekly check found it gone (P1-W6-S03)
};
export type SavedItem = LibraryProgress & {
  itemId: string;
  articleTitle: string;
  sourceName: string;
  savedAt: Date;
};
export type HistoryItem = LibraryProgress & {
  itemId: string;
  articleTitle: string;
  sourceName: string;
  lastFinishedAt: Date;
};
export interface Library {
  saves(userId: string, limit: number): Promise<SavedItem[]>;
  // Articles with a finished section, or finished whole; newest finish first.
  history(userId: string, limit: number): Promise<HistoryItem[]>;
}

// A row id as forms carry it (a content item or a source): a positive bigint.
export const BIGINT_ID = /^[1-9][0-9]{0,18}$/;

// The feedback controls (§5C, Q-P1-15, P1-W4-S07). Each returns whether it changed
// anything: a repeat counts no event and queues no recompute. An item that doesn't
// exist changes nothing. None touches the user's explicit choices (PER-1).
export interface Feedback {
  give(userId: string, itemId: string, kind: FeedbackKind): Promise<boolean>;
  // Only right after it was given (owner, 2026-10-26); More and Less stay.
  undoNotInterested(userId: string, itemId: string): Promise<boolean>;
  // The item's source, hidden for this user; undone from settings (Q-P1-36).
  hideSource(userId: string, itemId: string): Promise<boolean>;
  save(userId: string, itemId: string): Promise<boolean>;
  unsave(userId: string, itemId: string): Promise<boolean>;
  // ADR-0027: the card's stated reason is wrong; once per user, item and
  // reason. False when already reported (or the item is gone).
  reportReason(
    userId: string,
    itemId: string,
    reason: ReasonKind,
  ): Promise<boolean>;
  notInterested(userId: string, itemId: string): Promise<boolean>;
  // The Profile page (§5A, Q-P1-36, P1-W4-S08).
  hiddenSources(userId: string): Promise<{ sourceId: string; name: string }[]>;
  unhideSource(userId: string, sourceId: string): Promise<boolean>;
  inferred(userId: string): Promise<Inferred>;
  // Clears More and Less like this and stops Not interested items' concepts from
  // down-ranking; those items stay hidden, and saves stay (owner, 2026-10-26).
  resetInferred(userId: string): Promise<void>;
}

// Test 60s (Q-P2-14, P2-W9-S01): a 60-second sprint over a moment's (or, momentId
// null, an article's) concepts. The server holds the clock and serves one question at
// a time; the key never leaves it before the answer.
export const QUIZ_SECONDS = 60;
export type QuizQuestion = {
  questionId: string;
  stem: string;
  servedAt: Date;
  aiDrafted: boolean; // ADR-0037: a model drafted it, so it's labeled
} & (
  | { kind: "choice"; options: string[] }
  // P3-W13-S04 (§6.3): answered with a number in this unit.
  | { kind: "estimate"; unit: string }
);
// P3-W13-S04 (C-27): an estimate's answer, scored 0 to 1.
export type EstimateResult = {
  answer: number;
  unit: string;
  score: number;
  servedAt: Date;
  answeredAt: Date;
  firstTime: boolean; // false: a resubmission (LOAD-5) given the stored result
};
export type QuizResult = {
  correct: boolean;
  correctOption: number;
  servedAt: Date;
  answeredAt: Date;
  firstTime: boolean; // false: a resubmission (LOAD-5) given the stored result
};
// P3-W15-S05: a live match whose evidence was just applied, for its DB-5 event.
export type MatchApplied = {
  outcome: "finished" | "abandoned";
  won: boolean;
  abandoned: boolean;
  // P3-W18-S03 (§6.1): its wrong answers' sections, back to reading as a sprint's are.
  missed: { itemId: string; momentId: string }[];
};

export interface Quizzes {
  // Null when the target has no live question its source's rights allow (ING-2).
  // A start while the user's sprint on the same target still runs returns that one
  // (LOAD-5: a double-tap starts one quiz), firstTime false.
  start(
    userId: string,
    itemId: string,
    momentId: string | null,
  ): Promise<{ attemptId: string; endsAt: Date; firstTime: boolean } | null>;
  // The open question (the same one until it's answered), else the next; "over" when
  // the clock has run out or nothing is left; null when the attempt isn't the user's.
  next(
    userId: string,
    attemptId: string,
  ): Promise<QuizQuestion | "over" | null>;
  // "late" after the clock (and its grace); null when the question wasn't served in
  // the user's attempt, or is an estimate.
  answer(
    userId: string,
    attemptId: string,
    questionId: string,
    chosen: number,
  ): Promise<QuizResult | "late" | null>;
  // P3-W13-S04: the same for an estimate, answered with a positive number; null also
  // when the question isn't one. Never mastery or review evidence (owner, 2026-10-31).
  answerEstimate(
    userId: string,
    attemptId: string,
    questionId: string,
    guess: number,
  ): Promise<EstimateResult | "late" | null>;
  finish(userId: string, attemptId: string): Promise<QuizFinish | null>;
  // Q-P2-16: the user's quizzes left open (a sprint past its clock, a review idle 30
  // minutes) closed and rated; what it closed, so its finish can be recorded (owner,
  // 2026-10-28, Q-P2-28). Callers close before a start: the starts don't.
  closeStale(userId: string): Promise<(QuizFinish & { attemptId: string })[]>;
  // P2-W9-S02: which of these targets would start a quiz, as `quizKey` keys.
  offered(
    targets: { itemId: string; momentId: string | null }[],
  ): Promise<Set<string>>;
  // The attempt's header and results; null when it isn't the user's.
  attempt(userId: string, attemptId: string): Promise<QuizAttempt | null>;
  // P2-W9-S05 (Q-P2-17): the concepts due for review that have a live question to
  // ask, most overdue first, up to 10 (one session's worth).
  // daysSince: whole days since the concept was last recalled (null: never).
  dueReviews(
    userId: string,
  ): Promise<{ conceptId: string; name: string; daysSince: number | null }[]>;
  // A review session over them, untimed; the running one if there is one; null when
  // nothing is due.
  startReview(userId: string): Promise<{
    attemptId: string;
    concepts: number;
    firstTime: boolean;
  } | null>;
  // P3-W13-S02 (§6.3, Q-P3-04): a solo 60-second sprint over the player's concepts;
  // the running one if there is one (LOAD-5), even one whose clock has just run out;
  // null when there's no live question the player wasn't served this week.
  startSprint(
    userId: string,
  ): Promise<{ attemptId: string; endsAt: Date; firstTime: boolean } | null>;
  // P3-W13-S04 (§6.3, owner 2026-10-31): the same over estimation questions.
  startEstimation(
    userId: string,
  ): Promise<{ attemptId: string; endsAt: Date; firstTime: boolean } | null>;
  // P3-W13-S05 (§6.3, Q-P3-06): today's daily challenge (UTC), one attempt a day: the
  // player's attempt if there is one, finished or not; null when today has no set
  // with a question rounds may serve.
  startDaily(
    userId: string,
  ): Promise<{ attemptId: string; endsAt: Date; firstTime: boolean } | null>;
  // Today's challenge for the player, and their streak (Q-P3-07).
  dailyStatus(userId: string): Promise<DailyStatus>;
  // P3-W13-S06 (§6.3): a finished daily challenge's shared card, read by anyone with
  // its link. Never a question: only the day, points, streak and a dot per question.
  dailyShare(shareId: string): Promise<DailyShare | null>;
  // P2-W10-S04 (§5F, Q-P2-26): a checkpoint on a section of the user's active path,
  // once it's open and its readings are finished, not yet passed, with a live
  // question; the running one if there is one (LOAD-5); null otherwise.
  startCheckpoint(
    userId: string,
    sectionId: string,
  ): Promise<{
    attemptId: string;
    pathId: string;
    firstTime: boolean;
  } | null>;
  // P2-W11-S06 (Q-P2-35): a chapter checkpoint of the user's ready book, once it's
  // ready; the running one if there is one (LOAD-5); null otherwise.
  startBookCheckpoint(
    userId: string,
    chapterId: string,
  ): Promise<{ attemptId: string; bookId: string; firstTime: boolean } | null>;
  // P2-W9-S07 (Q-2, Q-P2-18): flag a question answered in the user's attempt, once
  // per user; true when this was the user's first flag on it.
  flag(
    userId: string,
    attemptId: string,
    questionId: string,
    reason: FlagReason,
  ): Promise<boolean>;
  // A question answered in the user's attempt, key included, for its feedback.
  answered(
    userId: string,
    attemptId: string,
    questionId: string,
  ): Promise<QuizFeedback | null>;
  // P3-W15-S05 (PER-2, ARCH-2): the user's live match answers, recorded by the worker,
  // applied as mastery evidence and review ratings with the sprint's rules, each match
  // once (two page loads at once apply it once).
  applyMatchEvidence(userId: string): Promise<MatchApplied[]>;
}

export type QuizFinish = {
  answered: number;
  correct: number; // an estimation round's: answers at full points
  firstTime: boolean;
  checkpoint: { at: CheckpointAt; passed: boolean } | null;
  sprint: boolean; // a game from Play (P3-W13-S02), recorded as one
  estimation: { points: number } | null; // a sprint over estimates (P3-W13-S04)
  daily: { points: number } | null; // the daily challenge (P3-W13-S05)
  // P3-W18-S03 (§6.1): the sections a game sent back to reading, as its results
  // page's Read again lists them (a hand-written page has no item and isn't here).
  missed: { itemId: string; momentId: string }[];
};
// Where a checkpoint belongs: a section of a topic path (P2-W10-S04) or a chapter of
// the user's book (P2-W11-S06).
export type CheckpointAt =
  | { kind: "path"; pathId: string; sectionId: string }
  | { kind: "book"; bookId: string; chapterId: string };
// Where a checkpoint's Close and Back lead: its path, or its chapter's end.
export const checkpointHome = (at: CheckpointAt): string =>
  at.kind === "path"
    ? `/paths/${at.pathId}`
    : `/books/${at.bookId}/checkpoint/${at.chapterId}`;

export type Streak = { days: number; freezes: number };
export type DailyStatus = {
  // "none": no set today, or none of its questions may be served.
  today:
    "none" | "open" | { attemptId: string; finished: boolean; points: number };
  streak: Streak;
};
// A dot per question in set order: 1 a right choice, an estimate's points out of 100,
// 0 a miss or a question not reached. The streak is as of that day. A question deleted
// since (purged with its moment, ING-2) loses its dot but keeps its points.
export type DailyShare = {
  day: string;
  points: number;
  streak: Streak;
  dots: number[];
};

export const quizKey = (itemId: string, momentId: string | null): string =>
  `${itemId}.${momentId ?? ""}`;
export type QuizAttempt = {
  // A review session (P2-W9-S05) has no article and no clock.
  review: boolean;
  // A solo sprint (P3-W13-S02) has no article, and a clock.
  sprint: boolean;
  // A sprint over estimates (P3-W13-S04): its points (up to 100 an answer, C-27) and
  // each answer with the real one and its source (AI-3).
  estimation: { points: number; answers: EstimateReveal[] } | null;
  // The daily challenge (P3-W13-S05): its points (100 a right choice, an estimate's
  // up to 100), its estimates as a round's, the player's streak after it, and the
  // id of its share link (P3-W13-S06).
  daily: {
    points: number;
    answers: EstimateReveal[];
    streak: Streak;
    shareId: string;
  } | null;
  itemId: string | null;
  momentId: string | null;
  title: string; // the section's, else the article's; "Review", "60-second sprint"
  startedAt: Date;
  endsAt: Date | null;
  // By the database's clock, which holds the sprint's (0 once it has run out); null
  // for an untimed review.
  secondsLeft: number | null;
  finishedAt: Date | null;
  answered: number;
  correct: number;
  avgMs: number | null; // from serving to answering; null before any answer
  // The concepts its answered questions test, with the user's state (null: unseen).
  concepts: { name: string; state: LearnerState | null }[];
  checkpoint: CheckpointInfo | null;
  // A sprint's wrong answers' sections, to read again (§6.1); empty otherwise.
  missed: {
    itemId: string;
    momentId: string;
    sectionTitle: string;
    frameable: boolean;
  }[];
};
// P2-W10-S04 (Q-P2-26): up to 5 questions; 4 of 5 pass, all but one of fewer.
export const CHECKPOINT_SIZE = 5;
// The same rule as quiz_attempt.pass_mark, which settles a taken checkpoint.
export const passMark = (size: number): number =>
  size >= CHECKPOINT_SIZE ? 4 : Math.max(size - 1, 1);
export type CheckpointInfo = {
  at: CheckpointAt;
  title: string; // the section's concepts, or the chapter's title
  concepts: string[]; // the section's or chapter's
  size: number;
  passMark: number;
  passed: boolean; // this attempt reached its pass mark
  // The next section's concepts; null after the last section, and for a book (its
  // chapters don't lock: owner, 2026-10-29).
  next: string[] | null;
  missed: string[]; // concepts of its wrong answers, due for review now
};
export type QuizFeedback =
  | {
      kind: "choice";
      stem: string;
      options: string[];
      chosen: number;
      correctOption: number;
      correct: boolean;
      flagged: boolean; // by this user (P2-W9-S07)
      aiDrafted: boolean; // ADR-0037
    }
  | ({ kind: "estimate"; flagged: boolean } & EstimateReveal);
// An answered estimate with the real answer and where it comes from (AI-3).
export type EstimateReveal = {
  questionId: string;
  stem: string;
  aiDrafted: boolean; // ADR-0037
  guess: number;
  answer: number;
  unit: string;
  score: number;
  // null: its moment's source no longer allows moments, or its link broke (ING-2).
  source: EstimateSource | null;
};
export type EstimateSource =
  // A hand-written question's page and the sentence quoted from it (P3-W13-S03).
  | { kind: "page"; url: string; title: string; citation: string }
  // A moment's section, read through the reader; never its quote (Q-P2-12).
  | {
      kind: "section";
      itemId: string;
      momentId: string;
      sectionTitle: string;
      frameable: boolean;
    };

// Notes (§5I, Q-P2-01, P2-W7-S03): a user's private note on a section, or on the
// article when momentId is null. Never shown to anyone else.
export interface Notes {
  get(
    userId: string,
    itemId: string,
    momentId: string | null,
  ): Promise<string | null>;
  // Writes or replaces it; false when the ids name no section of that article.
  save(
    userId: string,
    itemId: string,
    momentId: string | null,
    body: string,
  ): Promise<boolean>;
  // False when there was none.
  remove(
    userId: string,
    itemId: string,
    momentId: string | null,
  ): Promise<boolean>;
  // P2-W7-S04: the Library's list, newest edit first.
  list(userId: string, limit: number): Promise<NoteEntry[]>;
  // Notes on these items' own sections or the articles themselves, for their cards;
  // not those whose section was re-segmented away.
  onItems(
    userId: string,
    itemIds: string[],
  ): Promise<{ itemId: string; momentId: string | null; body: string }[]>;
  // By the note's own id (the Library), which also reaches a note whose section was
  // re-segmented away; what it was on, or null when the user has no such note.
  update(
    userId: string,
    noteId: string,
    body: string,
  ): Promise<NoteTarget | null>;
  removeById(userId: string, noteId: string): Promise<NoteTarget | null>;
}
export type NoteTarget = { itemId: string; momentId: string | null };
export type NoteEntry = NoteTarget & {
  noteId: string;
  // The section's title, kept when the section is gone; null on the article's note.
  sectionTitle: string | null;
  articleTitle: string;
  sourceName: string;
  body: string;
  frameable: boolean;
  linkBroken: boolean;
};

export interface DatabasePing {
  // Resolves when the database answers; rejects otherwise.
  ping(): Promise<void>;
}

export type BetaGroup = "student" | "developer";

// Q-P1-24: any access in the private beta needs a code; the code sets the group.
export type Redemption =
  | { ok: true; inviteCodeId: string; betaGroup: BetaGroup }
  | { ok: false; reason: "unknown" | "expired" | "used_up" };

export interface InviteCodes {
  // Consumes one use when the code is valid; never consumes on failure. Better Auth
  // creates users in its own transactions, so a guest start that fails afterwards
  // gives the use back with release() (owner choice, 2026-10-25).
  redeem(code: string): Promise<Redemption>;
  // Gives back one use after a redeem whose user creation failed; never below zero.
  release(inviteCodeId: string): Promise<void>;
}

export type Actor = { userId: string; isGuest: boolean; betaGroup: BetaGroup };

// Guest creation failed after the user row was written, and removing that row failed
// too: the guest holds the code's use, so it must not be released.
export class GuestNotRemoved extends Error {
  override name = "GuestNotRemoved";
}

// Account first (ADR-0016): an account half made (no session) that couldn't be removed.
// It still holds its invite use, so the use must not be given back.
export class AccountNotRemoved extends Error {
  override name = "AccountNotRemoved";
}

// P3-W13-S07 (ADR-0029): at most 10 guests a day from one network. Only a guest that
// started counts, so mistyped codes don't use up a shared network's day.
export interface GuestLimits {
  allow(ip: string): Promise<boolean>;
  record(ip: string): Promise<void>;
}

// P3-W14-S01 (§6.7, CACHE-3; owner, 2026-11-02): a board per daily challenge, and a
// weekly board (ISO weeks, UTC) each for sprints and estimation rounds. A player's
// score on a board is the total of their games on it. Boards are named
// "daily:2026-11-02", "sprint:2026-W45", "estimation:2026-W45".
// P3-W14-S02 (owner, 2026-11-02): each board also has a board per country, of the
// players whose country it is now; P3-W14-S04 likewise per university. A board's name
// and a scope become a Valkey key, so a caller checks them first: a board against the
// names above, a country against COUNTRY_CODES, a university id against BIGINT_ID.
export type BoardScope = { country: string } | { university: string };
export type Standing = { userId: string; score: number; rank: number };
// P3-W14-S04 (C-17, Q-P3-10; owner, 2026-11-02): until ratings, a university's score on
// a board is the average total of its players with a score there.
export type UniversityStanding = {
  universityId: string;
  score: number;
  rank: number;
};
export interface Leaderboards {
  // A finished game's score on its board, once per attempt (LOAD-5); nothing for
  // another player's attempt, an unfinished one, or one that isn't a game.
  record(userId: string, attemptId: string, score: number): Promise<void>;
  // Highest first. Equal totals share a rank: 1 + the players strictly ahead.
  top(board: string, limit: number, scope?: BoardScope): Promise<Standing[]>;
  standing(
    board: string,
    userId: string,
    scope?: BoardScope,
  ): Promise<Standing | null>;
  // P3-W14-S05: the given players on a board, ranked among themselves (the friends
  // board: a player and those they follow); players without a score are left out.
  among(board: string, userIds: string[]): Promise<Standing[]>;
  // P3-W14-S06: how many players are on the board (for a percentile).
  size(board: string, scope?: BoardScope): Promise<number>;
  // Universities on a board, highest average first; ranks as `top`'s.
  universities(board: string, limit: number): Promise<UniversityStanding[]>;
  universityStanding(
    board: string,
    universityId: string,
  ): Promise<UniversityStanding | null>;
  // P3-W14-S06: how many universities are ranked on the board (for a percentile).
  universityCount(board: string): Promise<number>;
  // After a guest merge (P3-W13-S07) or a change of country or university (with the
  // scopes it was in): the player's boards and the university averages they count in
  // are worked out again. Never throws: a failure is logged, and the boards catch up
  // within minutes.
  invalidate(userId: string, former?: BoardScope[]): Promise<void>;
}

// P3-W15-S02 (ADR-0033; owner, 2026-11-02): live matches and their players, accounts or
// guests. Matchmaking (W16) creates them; until then `pnpm game:match` does.
// P3-W15-S03 (Q-P3-22): a live match as its game server receives it, keys included;
// they never reach a player before the round ends.
export type LiveRound = {
  question: string;
  stem: string;
  options: string[];
  correct: number;
  ai: boolean; // ADR-0037: model-drafted, so labeled "AI-drafted"
};
// P3-W16-S04 (Q-P3-23): a sprint, or Q-P3-22's rounds (fastest finger from W16-S05).
export const GAME_MODES = ["sprint", "fastest_finger"] as const;
export type GameMode = (typeof GAME_MODES)[number];
export type LiveMatch = {
  id: string;
  serverId: number;
  players: string[];
  mode: GameMode;
  rounds: LiveRound[];
  // P3-W17-S01 (BOT-1, BOT-3, Q-P3-25): the other seat replays a recorded run, shown
  // only by its label; its answers are ids and times.
  ghost?: { player: string; label: string; answers: GhostAnswer[] };
};
export type GhostAnswer = { n: number; choice: number; ms: number };
// The questions a match plays (owner: 7 rounds, 2026-11-02; a sprint's 30, 2026-11-03).
export const LIVE_QUESTIONS: Record<GameMode, number> = {
  fastest_finger: 7,
  sprint: 30,
};

export interface Matches {
  // A new match of its mode's LIVE_QUESTIONS live multiple-choice questions (the
  // sprint's rights rule, ING-2); null when the bank has fewer than that.
  // `unrated`: a friend challenge (P3-W17-S03, Q-P3-16) moves no rating.
  create(
    serverId: number,
    players: string[],
    mode: GameMode,
    options?: { unrated: boolean },
  ): Promise<LiveMatch | null>;
  // P3-W17-S01 (Q-P3-25): a match against a ghost, a same-mode run from the last 30 days
  // by someone else with every question still live: one never met first, the nearest
  // rating first; with all met, the one met longest ago. Null when there's none.
  createGhost(
    serverId: number,
    userId: string,
    mode: GameMode,
  ): Promise<LiveMatch | null>;
  // P3-W17-S02 (BOT-2, Q-P3-26): a match against a synthetic bot, labeled and rated at
  // the player's own rating; null when the bank is short.
  createBot(
    serverId: number,
    userId: string,
    mode: GameMode,
  ): Promise<LiveMatch | null>;
  // P5-W31-S02b-2b (§6.5): an LLD battle on a loaded problem, for the game server's
  // battle actor; its id. Its result is stored like any match's; ratings come in W32.
  createBattle(
    serverId: number,
    players: string[],
    slug: string,
  ): Promise<string>;
  // The game server that owns the match, and the id the player plays as there (a guest
  // who signed up mid-match keeps the guest's, Q-P3-21), when the player is in it; null
  // otherwise (no such match, or not theirs).
  serverFor(
    matchId: string,
    userId: string,
  ): Promise<{ serverId: number; playedAs: string } | null>;
}

// P3-W16-S02 (MATCH-3, Q-P3-14; owner, 2026-11-03): a queue for live 1v1 that pairs
// players within a rating band, ±100 widening by 100 every 2 s, both ways. Pairing
// happens as players poll; a pair gets a match on its game server.
// `first`: the first time this player hears of the match (its time-to-match event).
export type QueueState =
  | { status: "waiting"; waitedMs: number }
  | { status: "matched"; matchId: string; waitedMs: number; first: boolean }
  | { status: "none" };
export interface Matchmaking {
  // Joining again while queued, pending or matched changes nothing (the wait goes on).
  join(userId: string, rating: number): Promise<void>;
  // Tries to pair the player first. A match stays reported for a minute, every poll.
  poll(userId: string): Promise<QueueState>;
  // Out of the queue. Leaving while being paired puts the other back in the queue; once
  // matched, it's too late (the game server cancels a match nobody starts).
  leave(userId: string): Promise<void>;
}

// P3-W17-S03 (Q-P3-16; owner, 2026-11-03): friend challenge links and the presence
// they need. A link lasts 10 minutes and admits one friend, not its sender; the sender
// is online when they used the app in the last 2 minutes; the friend's acceptance waits
// a minute for the sender's open tab to pick it up.
export type Challenge = { sender: string; mode: GameMode };
export type ChallengeState =
  ({ status: "open" } & Challenge) | { status: "expired" | "taken" | "own" };
export type ChallengeAccepted = { matchId: string; mode: GameMode };
export const CHALLENGE_SECONDS = 600;
export const ONLINE_SECONDS = 120;
export const ACCEPTED_SECONDS = 60;
export interface Challenges {
  create(sender: string, mode: GameMode): Promise<string>; // the link's token
  // Where it stands for this opener, without taking it.
  peek(token: string, opener: string): Promise<ChallengeState>;
  // Taken once, by the first opener: "taken" for everyone after.
  take(token: string, opener: string): Promise<ChallengeState>;
  // P3-W17-S04: with the page open then (kept 2 hours: the agent hook's place).
  beat(userId: string, page?: string): Promise<void>;
  online(userId: string): Promise<boolean>;
  lastPage(userId: string): Promise<string | null>;
  // The agent finished and the place was saved: told once, within 2 minutes.
  noteAgentFinished(userId: string): Promise<void>;
  takeAgentFinished(userId: string): Promise<boolean>;
  notify(sender: string, accepted: ChallengeAccepted): Promise<void>;
  pending(sender: string): Promise<ChallengeAccepted | null>;
}

// P3-W17-S05b (§7, Q-P3-18): browsers that asked for the agent hook's notifications.
export type PushSubscriptionKeys = {
  endpoint: string;
  p256dh: string;
  auth: string;
};
export interface PushSubscriptions {
  // A browser's subscription, now the player's (a browser re-subscribing moves it).
  save(userId: string, subscription: PushSubscriptionKeys): Promise<void>;
  // Only the player's own.
  remove(userId: string, endpoint: string): Promise<void>;
}

// P4-W19-S04a (Q-P4-03): a phone's APNs (ios) or FCM (android) token, for the worker's
// native pushes (S04b). One owner per token: a phone signed in as someone else moves it
// (an account that knew another's token could take it; tokens aren't public).
export type PushPlatform = "ios" | "android";
export interface DevicePushTokens {
  save(userId: string, platform: PushPlatform, token: string): Promise<void>;
  // Only the user's own.
  remove(userId: string, token: string): Promise<void>;
}

// Calls counted per key in a fixed window: false once past `limit` (P3-W17-S04: a
// device's agent hook calls, against a leaked token or a looping script).
export interface RateLimits {
  allow(key: string, limit: number, windowSeconds: number): Promise<boolean>;
}

// P3-W17-S04 (§7, C-09, C-10, LOAD-5, Q-P3-28; owner, 2026-11-03): the agent hook. A
// device sends only "started" and "finished"; its token is kept as a hash. A task with
// no finish for 2 hours has ended; "finished" saves the player's place for 24 hours.
export type AgentDevice = {
  id: string;
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
};
export const MAX_AGENT_DEVICES = 10;
export const AGENT_TASK_MS = 2 * 3_600_000;
export const AGENT_PLACE_MS = 24 * 3_600_000;
export type AgentFinish =
  { status: "finished"; elapsedMs: number } | { status: "repeat" | "none" };
export interface AgentHook {
  devices(userId: string): Promise<AgentDevice[]>; // not revoked, newest first
  // The token is returned this once; "full" at MAX_AGENT_DEVICES.
  addDevice(
    userId: string,
    name: string,
  ): Promise<{ device: AgentDevice; token: string } | "full">;
  revoke(userId: string, deviceId: string): Promise<void>;
  // A live device by its token (and marked used now); null for anything else.
  deviceFor(
    token: string,
    now: Date,
  ): Promise<{ deviceId: string; actor: Actor } | null>;
  // A repeated key does nothing (LOAD-5); a new start ends the device's running task.
  // The new task's id when it started (P3-W17-S05b nudges it 45 s on).
  start(
    deviceId: string,
    key: string,
    now: Date,
  ): Promise<{ status: "started"; taskId: number } | { status: "repeat" }>;
  // Saves `place` (the page last open) with the finish, in one step.
  finish(
    deviceId: string,
    key: string,
    now: Date,
    place: string | null,
  ): Promise<AgentFinish>;
  running(userId: string, now: Date): Promise<{ startedAt: Date } | null>;
  // Saved within 24 hours and not opened since.
  place(userId: string, now: Date): Promise<string | null>;
  openedPlace(userId: string, path: string, now: Date): Promise<void>;
}

// P3-W16-S01 (ADR-0034): a player's quick-game rating; 1500 before their first match.
export interface PlayerRatings {
  of(userId: string): Promise<number>;
  // P3-W18-S02 (§6.9; owner, 2026-11-05): the player's confirmed fair-play penalties,
  // newest first: the rating each removed (0 when its match gained nothing).
  adjustments(userId: string): Promise<{ penalty: number; playedAt: Date }[]>;
}

// P3-W15-S03 (Q-P3-22): hands a match to its game server (game:match:<id> in Valkey),
// which never reads Postgres (ADR-0033).
export interface MatchHandoff {
  put(match: LiveMatch): Promise<void>;
  // P5-W31-S02b: an LLD battle, for the game server's battle actor.
  putBattle(match: BattleMatch): Promise<void>;
}

// P5-W31-S02b (§6.5, Q-P5-15; LLDQ-4): an LLD battle as handed to the game server: the
// harnesses per language, and every scenario with its expected results. It stays in
// Valkey and the game server; no client ever receives it.
export type BattleFile = { name: string; content: string };
export type BattleMatch = {
  id: string;
  players: string[];
  battle: {
    problem: string;
    limits: Problem["limits"];
    checks: NonNullable<Problem["checks"]>;
    languages: Record<
      string,
      { solution: string; base: BattleFile[]; extension: BattleFile[] }
    >;
    scenarios: { layer: string; stdin: string; expected: ResultLine[] }[];
  };
};

// P3-W14-S05 (§6.7, Q-P3-11; owner, 2026-11-02): every account's username, chosen once
// and never changed, shown on boards in place of its name. `username` is checked by
// usernameOf (server/usernames.ts).
export interface Usernames {
  get(
    userId: string,
  ): Promise<{ username: string; searchable: boolean } | null>;
  // "has-one": the account has a username already (it never changes).
  claim(
    userId: string,
    username: string,
  ): Promise<"claimed" | "taken" | "has-one">;
  setSearchable(userId: string, searchable: boolean): Promise<void>;
  // Searchable players whose username starts with `prefix`, in username order.
  search(prefix: string, limit: number): Promise<Person[]>;
  // The exact username, searchable or not; null when nobody has it.
  byName(username: string): Promise<string | null>;
  // P3-W14-S06: what boards call each player: its username, or none yet (a guest, or an
  // account not yet asked); unknown ids are left out.
  labels(
    userIds: string[],
  ): Promise<{ userId: string; username: string | null; guest: boolean }[]>;
}
export type Person = { userId: string; username: string };

// One way, no accept step (Q-P3-11); a player sees who follows them (owner, 2026-11-02).
export interface Follows {
  // Whether it is new; following oneself is refused (false).
  follow(followerId: string, followeeId: string): Promise<boolean>;
  // Whether there was one.
  unfollow(followerId: string, followeeId: string): Promise<boolean>;
  // Players with a username only, in username order.
  following(userId: string): Promise<Person[]>;
  followers(userId: string): Promise<Person[]>;
}

// P3-W14-S02 (§6.7, Q-P3-08; owner, 2026-11-02): an account's country, optional, set
// or changed at most once in 30 days; removing it is always allowed and keeps the clock.
export interface PlayerCountries {
  // changeableFrom: when a set or change is next allowed; null when it is now.
  get(
    userId: string,
  ): Promise<{ country: string | null; changeableFrom: Date | null }>;
  set(
    userId: string,
    country: string,
  ): Promise<
    { ok: true; previous: string | null } | { ok: false; changeableFrom: Date }
  >;
  // The country it was, if any.
  remove(userId: string): Promise<string | null>;
}

// P3-W14-S03 (§6.7, ADR-0032): a university from the list (listed) or typed by a player.
export type University = {
  id: string;
  name: string;
  country: string | null; // ISO alpha-2; null for a typed one
  listed: boolean;
};
export type UniversityChange =
  | { ok: true; university: University; previous: University | null }
  | { ok: false; reason: "soon"; changeableFrom: Date }
  | { ok: false; reason: "unknown" };

// Unverified, and no email (ADR-0032). Changed at most once in 30 days; removing is
// always allowed and keeps the clock (owner, 2026-11-02, as PlayerCountries).
export interface PlayerUniversities {
  get(
    userId: string,
  ): Promise<{ university: University | null; changeableFrom: Date | null }>;
  // Names containing the query, any case; those starting with it first, then shorter.
  search(query: string, limit: number): Promise<University[]>;
  // The same university again changes nothing and keeps the clock.
  set(userId: string, universityId: string): Promise<UniversityChange>;
  // The university already called that, in any case: the listed one when exactly one
  // has the name, else the typed one; else a new typed one. `name` is checked by
  // universityName (server/universities.ts).
  setTyped(userId: string, name: string): Promise<UniversityChange>;
  // The university it was, if any.
  remove(userId: string): Promise<University | null>;
  // P3-W14-S06: the universities with these ids (for the universities' board).
  names(ids: string[]): Promise<University[]>;
}

export interface GuestSessions {
  // Creates a guest (anonymous user) in the redemption's beta group and returns it with
  // the Set-Cookie values for its session. If it throws anything but GuestNotRemoved, no
  // user was left behind.
  start(
    redemption: Extract<Redemption, { ok: true }>,
    headers: Headers,
  ): Promise<{ setCookies: string[]; actor: Actor }>;
}

export interface SessionReader {
  current(headers: Headers): Promise<Actor | null>;
}

export type Mail = { to: string; subject: string; text: string };

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

export type CreateResult =
  | { ok: true; setCookies: string[]; actor: Actor }
  | { ok: false; reason: "email_taken" };

export type SignUpResult =
  | { ok: true; setCookies: string[] }
  | { ok: false; reason: "not_a_guest" | "email_taken" };

// Email-and-password accounts (ADR-0004). Inputs arrive validated and normalised.
// Sign-up and sign-in return the new session's Set-Cookie values, like GuestSessions.
export interface Accounts {
  // Account first (ADR-0016): a new account from an invite redemption, in its beta
  // group, signed in. Nothing is left behind when it refuses or throws, except when it
  // throws AccountNotRemoved.
  create(
    redemption: Extract<Redemption, { ok: true }>,
    input: { name: string; email: string; password: string },
    headers: Headers,
  ): Promise<CreateResult>;
  // Turns the current guest into the account, keeping its user id, code and group
  // (Q-P1-11, Q-P1-24), and replaces the guest's session with a new one.
  signUp(
    headers: Headers,
    input: { name: string; email: string; password: string },
  ): Promise<SignUpResult>;
  // Null for an unknown email or a wrong password: the caller cannot tell which. A
  // guest signing in to an account is merged into it (P3-W13-S07, ADR-0029).
  signIn(
    headers: Headers,
    email: string,
    password: string,
  ): Promise<{
    setCookies: string[];
    actor: Actor;
    mergedGuest: boolean;
  } | null>;
  signOut(headers: Headers): Promise<void>;
  // Mails a reset link if the account exists; returns the same either way.
  requestReset(email: string): Promise<void>;
  // False for an unknown, used or expired token.
  resetPassword(token: string, newPassword: string): Promise<boolean>;
  // ADR-0030, local only: no link. False when no account has a password for it.
  setPassword(email: string, newPassword: string): Promise<boolean>;
}

// DB-5: where events go. Returns the records it could not deliver, for one retry.
export interface EventSink {
  write(batch: Envelope[]): Promise<{ failed: Envelope[] }>;
}

// OPS-3, Q-P1-22: features ask what a user may do; plans and grants live in the database.
// Capability is the generated enum, so an unknown capability does not compile.
export interface Entitlements {
  can(userId: string, capability: Capability): Promise<boolean>;
  // The plan's limit; null when the capability has no limit, 0 when it isn't granted.
  // Compare as `limit === null || used < limit`: `used < (limit ?? 0)` would turn "no
  // limit" into "none allowed".
  limit(userId: string, capability: Capability): Promise<number | null>;
}

// ADR-0014: the enqueue side of the queue port (BullMQ on Valkey, or SQS). Messages are
// the schemas in packages/db/messages; the worker consumes them.
export interface JobQueue {
  enqueue<N extends MessageName>(
    name: N,
    message: Messages[N],
    options: { idempotencyKey: string; delaySeconds?: number },
  ): Promise<void>;
}

// ING-6, Q-P1-29: what the admin review page reads and writes (P1-W3-S05). Section
// headings and counts only; never body text (Q-P1-01).
export type ReviewTags = { difficulty: Difficulty; concepts: string[] };

export type ReviewItem = {
  id: string;
  title: string;
  url: string;
  sourceName: string;
  // Section headings in page order; null for the intro.
  sections: {
    heading: string | null;
    level: number | null;
    wordCount: number;
  }[];
  // heading is null for the intro moment, which starts at the top of the page.
  moments: {
    ordinal: number;
    title: string;
    heading: string | null;
    estimatedMinutes: number;
    oversized: boolean;
  }[];
  // The model's tags (AI-3); moment tags by ordinal.
  modelTags: { item: ReviewTags | null; moments: Map<number, ReviewTags> };
  // The admin's corrections, kept apart and keyed by heading so they survive
  // re-ingestion: boundaries are the headings moments start at; tag overrides are by
  // heading, "" for the item itself.
  boundaries: string[] | null;
  tagOverrides: Map<string, ReviewTags>;
};

export type ReviewListing = {
  id: string;
  title: string;
  sourceName: string;
  momentCount: number;
  // ADR-0026: users' "a reason is wrong" reports on it, by reason, most first.
  reports: { reason: ReasonKind; count: number }[];
};

export interface AdminReview {
  recent(limit: number): Promise<ReviewListing[]>;
  item(id: string): Promise<ReviewItem | null>;
  // Slugs of the concepts that may be tagged (not retired).
  activeConcepts(): Promise<string[]>;
  // null clears the override, so the 2-8 minute rules apply again.
  setBoundaries(
    itemId: string,
    headings: string[] | null,
    by: string,
  ): Promise<void>;
  // heading "" is the item itself; null clears the override.
  setTags(
    itemId: string,
    heading: string,
    tags: ReviewTags | null,
    by: string,
  ): Promise<void>;
}

// §3.2, P1-W3-S06: the per-source moments switch. The seed file owns every other
// setting, including whether a source is polled at all (ADR-0006 C-28).
export type SourceSwitch = {
  id: string;
  name: string;
  rightsProfile: string;
  active: boolean;
  // What the seed file says, whether an admin switched moments off, and the result.
  momentsSeeded: boolean;
  momentsSwitchedOff: boolean;
  momentsEnabled: boolean;
};

// Ranking inspection (REC-2, P1-W6-S01): how the worker made each score, by rule.
export type ScoreBreakdown = {
  values: Record<string, number>; // each signal, 0-1
  weights: Record<string, number>; // as scored, before any later edit
  weighted: Record<string, number>; // value times its weight
  penalty: number;
};

export type InspectedEntry = {
  rank: number;
  kind: "moment" | "article";
  articleTitle: string;
  sectionTitle: string | null;
  sourceName: string;
  topSignal: string;
  explored: { kind: string; arm: string } | null; // placed by exploration (REC-4)
  breakdown: ScoreBreakdown | null; // null: stored before P1-W6-S01
};

export type RankingSetting = { key: string; value: number; note: string };

export interface RankingInspection {
  // The user's own feed for a chip, in rank order, as the feed shows it.
  entries(userId: string, chip: BreakLength): Promise<InspectedEntry[]>;
  settings(): Promise<RankingSetting[]>;
  setSetting(
    key: string,
    value: number,
  ): Promise<"changed" | "unchanged" | "missing">;
}

// Q-2 (P2-W8-S03): the spot-check queue. A review is decided once: Keep returns a
// flagged question to live, Retire retires it.
export type ReviewDecision = "keep" | "retire";
export type ReviewQuestion = {
  questionId: string;
  reason: ReviewReason;
  stem: string;
  citation: string;
  // A hand-written question's source page has no section (P3-W13-S03).
  articleTitle: string;
  sectionTitle: string | null;
  link: string;
} & (
  | {
      kind: "choice";
      options: string[];
      correct: number;
      validatorAnswer: number | null;
    }
  | {
      kind: "estimate";
      answer: number;
      unit: string;
      // P3-W13-S03b: a generated estimate's validator number; null hand-written.
      validatorAnswer: number | null;
    }
);
// P3-W13-S03 (Q-P3-05 (b)): an estimation question the owner writes, citing the page
// that states the number (AI-3).
export type EstimateDraft = {
  stem: string;
  answer: number;
  unit: string;
  concepts: string[]; // slugs
  difficulty: Difficulty;
  sourceUrl: string;
  sourceTitle: string;
  citation: string;
};
export interface AdminQuestions {
  // Undecided reviews of questions still live or flagged, the oldest first: one
  // retired meanwhile (a redraft) needs no check.
  open(): Promise<ReviewQuestion[]>;
  // Live at once; null when a concept isn't a live one.
  writeEstimate(draft: EstimateDraft): Promise<string | null>;
  // False when there was no undecided review of that question.
  decide(
    questionId: string,
    decision: ReviewDecision,
    by: string,
  ): Promise<boolean>;
}

// Topic paths under review (§5F, Q-P2-23, Q-P2-24, P2-W10-S02).
export type PathStatus = "draft" | "live" | "retired";
export type ReviewPathSession = {
  ordinal: number;
  momentId: string;
  sectionTitle: string;
  articleTitle: string;
  sourceName: string;
  link: string;
  // The moment's rights now (ING-2): its source may have been switched off since.
  allowed: boolean;
};
export type ReviewPathSection = {
  sectionId: string;
  concepts: string[];
  sessions: ReviewPathSession[];
};
export type ReviewPath = {
  pathId: string;
  name: string;
  why: string;
  status: PathStatus;
  sections: ReviewPathSection[];
};
export interface AdminPaths {
  // Drafts first, then live, then retired; sections and sessions in order.
  list(): Promise<ReviewPath[]>;
  // Edits change drafts only (a live path changes under no one); false otherwise.
  rename(pathId: string, name: string, why: string): Promise<boolean>;
  moveSection(sectionId: string, direction: "up" | "down"): Promise<boolean>;
  removeSection(sectionId: string): Promise<boolean>;
  removeSession(sectionId: string, ordinal: number): Promise<boolean>;
  // Live only with 2+ sections, each with an allowed session; false otherwise.
  approve(pathId: string): Promise<boolean>;
  retire(pathId: string): Promise<boolean>;
}

// Following topic paths (§5F, Q-P2-27, P2-W10-S03).
export type UserPathStatus = "active" | "paused";
export type PathSummary = {
  pathId: string;
  name: string;
  why: string;
  sections: number;
  readings: number;
  minutes: number;
  mine: UserPathStatus | null;
  // Retired since the user started it: shown read-only, never resumed (owner,
  // 2026-10-28).
  retired: boolean;
  // The topic most of its concepts are on (null: no concepts yet), and whether any
  // of them is among the user's goal concepts (ADR-0015): the Paths page's tag,
  // filter and "Fits your goal".
  topic: Topic | null;
  fitsGoal: boolean;
};
export type PathReading = {
  momentId: string;
  itemId: string;
  sectionTitle: string;
  articleTitle: string;
  sourceName: string;
  minutes: number;
  frameable: boolean;
  linkBroken: boolean;
  finished: boolean;
  ordinal: number; // the session's place in its section (a swap's key)
};
// What a link to a reading needs (ReadingLink).
export type ReadingTarget = Pick<
  PathReading,
  "itemId" | "momentId" | "sectionTitle" | "frameable" | "linkBroken"
>;
export type PathFoundation = {
  conceptId: string;
  name: string;
  reading: ReadingTarget | null;
};
export type PathStep = {
  sectionId: string;
  concepts: string[];
  readings: PathReading[];
  // The first section is open; each next one once the one before is passed (S04).
  open: boolean;
  // P2-W10-S04 (Q-P2-26): "reading" until every reading (with a working link) is
  // finished; "ready" to take; "no_questions" while none is live to ask.
  checkpoint:
    "locked" | "reading" | "ready" | "no_questions" | "passed" | "skipped";
  // P2-W10-S05 (Q-P2-23): skipped by the user (until an unskip); moved ahead of
  // sections the approved order teaches first, their concepts (null: in order).
  skipped: boolean;
  warning: string[] | null;
  // Not passed and never skipped: the sections after it wait for it.
  holdsBack: boolean;
  // P2-W10-S07 (Q-P2-29): every live concept in it is mastered for the user.
  mastered: boolean;
  // P2-W10-S08 (Q-P2-30), on an open, unskipped section: direct prerequisites outside
  // the path the user has never explored, up to 3, each with one reading if any.
  foundations: PathFoundation[];
  // The questions it would ask now (0: none) and the pass mark that makes.
  size: number;
  passMark: number;
};
export type PathTimeline = {
  pathId: string;
  name: string;
  why: string;
  retired: boolean;
  mine: UserPathStatus | null;
  sections: PathStep[];
};
export interface Paths {
  // Live paths, and retired ones the user followed; the user's status on each.
  live(userId: string): Promise<PathSummary[]>;
  // A live path, or one the user follows that was retired since; readings its
  // rights no longer allow are left out (ING-2). Null otherwise.
  path(userId: string, pathId: string): Promise<PathTimeline | null>;
  // Makes it the user's active path, pausing any other; firstTime false when it was
  // already active; paused, the path its start paused; null when it isn't live.
  start(
    userId: string,
    pathId: string,
  ): Promise<{ firstTime: boolean; paused: string | null } | null>;
  // P2-W10-S05 (C-25, Q-P2-23): edits to the user's own copy of a live path they
  // follow; the approved path never changes. Each is false (or null) when refused.
  pause(userId: string, pathId: string): Promise<boolean>;
  // The first unfinished reading of the first open section, else a checkpoint ready
  // to take; null without an active path or with nothing left to do.
  next(userId: string): Promise<PathNext | null>;
  moveSection(
    userId: string,
    sectionId: string,
    direction: "up" | "down",
  ): Promise<string | null>; // the path's id
  // Not a passed or skipped section; no practiced credit, and the next ones open.
  skipSection(userId: string, sectionId: string): Promise<string | null>;
  unskipSection(userId: string, sectionId: string): Promise<string | null>;
  // Up to 5 other moments on the section's concepts, rights allowing, link working,
  // not already in the section; empty when the session can't be swapped.
  alternatives(
    userId: string,
    sectionId: string,
    ordinal: number,
  ): Promise<PathAlternative[]>;
  // Only to one of its alternatives, and only while the reading isn't finished.
  swapSession(
    userId: string,
    sectionId: string,
    ordinal: number,
    momentId: string,
  ): Promise<string | null>;
}
// P2-W10-S06 (REC-1, Q-P2-27): the active path's next step, the feed's first card.
export type PathNext =
  | {
      kind: "reading";
      pathId: string;
      pathName: string;
      sectionId: string;
      mastered: boolean; // to suggest skipping it (Q-P2-29)
      concepts: string[];
      reading: PathReading;
      n: number; // its place among the section's readings
      of: number;
    }
  | {
      kind: "checkpoint";
      pathId: string;
      pathName: string;
      sectionId: string;
      concepts: string[];
      size: number;
      passMark: number;
      next: string[] | null; // the concepts it unlocks; null for the last section
    };
export type PathAlternative = {
  momentId: string;
  sectionTitle: string;
  articleTitle: string;
  sourceName: string;
  minutes: number;
};

export interface AdminSources {
  list(): Promise<SourceSwitch[]>;
  get(id: string): Promise<SourceSwitch | null>;
  // Switching off removes the source's moments at once (the database's purge trigger).
  setMomentsSwitchedOff(id: string, off: boolean, by: string): Promise<void>;
  // Items whose stored full text can be segmented again when moments come back.
  fullTextItemIds(id: string): Promise<string[]>;
}

// §5A, PER-1, C-21, P1-W4-S01: the explicit layer. Feedback and inference never write
// it; only the user does (onboarding now, profile settings in W4-S08). The types are
// the generated enums; these lists are their values in display order.
export const TOPICS = [
  "system-design",
  "databases",
  "distributed-systems",
  "backend",
] as const satisfies readonly Topic[];
export function isTopic(value: string): value is Topic {
  return (TOPICS as readonly string[]).includes(value);
}
export const LEVELS = [
  "beginner",
  "intermediate",
  "advanced",
] as const satisfies readonly Difficulty[];
export const BREAK_LENGTHS = [
  "1-3",
  "3-8",
  "8-15",
] as const satisfies readonly BreakLength[];

// ADR-0015: learning goals, in the enum's order. The book goal is live with PDF books
// (Q-P2-36, P2-W11-S05), the stack goal with GitHub projects (P2-W12-S04).
export const GOALS = [
  "system-design-interviews",
  "stack-i-use",
  "finish-that-book",
  "stay-sharp",
] as const satisfies readonly LearningGoal[];
export const LIVE_GOALS = [
  "system-design-interviews",
  "stack-i-use",
  "finish-that-book",
  "stay-sharp",
] as const satisfies readonly LearningGoal[];

export type Preferences = {
  goals: LearningGoal[];
  topics: Topic[];
  level: Difficulty;
  breakLength: BreakLength;
};

export interface PreferencesStore {
  // With when onboarding saved them: a first feed is only waited for just after.
  // The account's first name rides along for Home's greeting (ADR-0019).
  get(
    userId: string,
  ): Promise<
    (Preferences & { onboardedAt: Date; firstName: string | null }) | null
  >;
  // Onboarding happens once: false when the user already had preferences, which
  // are then left as they were (a resubmit can't overwrite them).
  createIfAbsent(userId: string, preferences: Preferences): Promise<boolean>;
  // The Profile page's edit (P1-W4-S08); false before onboarding (nothing to edit).
  update(userId: string, preferences: Preferences): Promise<boolean>;
}

// DB-6, P2-W11-S01: private files (PDF books) in S3, or SeaweedFS locally (ADR-0011).
export type StoredFile = {
  body: ReadableStream<Uint8Array>;
  etag: string | null;
  size: number | null;
};
export interface FileStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  // The file as a stream (the reader, P2-W11-S04), with its version; "unchanged" when
  // it still matches `etag` (the browser's copy); null when nothing is at the key.
  get(key: string, etag?: string): Promise<StoredFile | "unchanged" | null>;
  // Nothing at the key is not an error.
  remove(key: string): Promise<void>;
}

// §5F, Q-P2-34 (P2-W11-S01): a user's private PDF books.
export type BookStatus = "processing" | "ocr" | "ready" | "failed";
export type BookSummary = {
  bookId: string;
  title: string;
  status: BookStatus;
  failure: string | null;
  createdAt: Date;
};
export interface Books {
  list(userId: string): Promise<BookSummary[]>;
  // "limit" when the user already has as many books as the plan allows (OPS-3).
  create(
    userId: string,
    title: string,
    sizeBytes: number,
    fileKey: string,
  ): Promise<{ bookId: string } | "limit">;
  // The removed book's file key; null when it isn't the user's.
  remove(userId: string, bookId: string): Promise<string | null>;
  // P2-W11-S04 (§5F, Q-P2-31): a ready book's session to read; with no session named,
  // where the user left off, else the first unfinished, else the first. Null when the
  // book isn't the user's or isn't ready; a session not in the book is ignored.
  reading(
    userId: string,
    bookId: string,
    sessionId: string | null,
  ): Promise<BookReading | null>;
  // True the first time; the book's id, for its event; the chapter's id when this
  // finished its last session (S06: its checkpoint is then made). Null when not the
  // user's.
  finish(
    userId: string,
    sessionId: string,
  ): Promise<{
    bookId: string;
    firstTime: boolean;
    chapterDone: string | null;
  } | null>;
  // False when the session isn't in the user's ready book.
  savePosition(
    userId: string,
    bookId: string,
    sessionId: string,
    fraction: number,
  ): Promise<boolean>;
  // The PDF's key, for the user's own ready book; null otherwise.
  fileKey(userId: string, bookId: string): Promise<string | null>;
  // P2-W11-S05 (§5F, Q-P2-33): the user's ready books, chapter by chapter.
  outlines(userId: string): Promise<BookOutline[]>;
  // The feed's book card: the next session of the ready book read last (or added
  // last); null when no ready book has a session left.
  nextSession(userId: string): Promise<BookNext | null>;
  // P2-W11-S06 (Q-P2-35): a finished chapter's checkpoint asked for, or asked again
  // after a failure (or a request stuck for STUCK_MINUTES); the request's number, to
  // key its job. Null when it isn't the user's finished chapter of a ready book, or
  // it is being made or made already.
  requestCheckpoint(userId: string, chapterId: string): Promise<number | null>;
  // The chapter's end: its checkpoint and the way on. Null when not the user's.
  checkpoint(userId: string, chapterId: string): Promise<ChapterEnd | null>;
}
export type CheckpointState = "none" | "preparing" | "ready" | "failed";
// A checkpoint still preparing after this long (its job lost) can be asked for again.
export const STUCK_MINUTES = 10;
export type ChapterEnd = {
  bookId: string;
  bookTitle: string;
  chapterId: string;
  title: string;
  finished: boolean; // every session marked done
  state: CheckpointState;
  stuck: boolean; // preparing for STUCK_MINUTES: it can be asked for again
  failure: string | null;
  size: number; // questions it will ask (up to 5)
  concepts: string[];
  last: { passed: boolean; correct: number; size: number } | null; // latest taken
  next: { sessionId: string; title: string } | null; // the next chapter's first
};
export type BookOutline = {
  bookId: string;
  title: string;
  done: number;
  of: number;
  first: string; // the first session, to read again
  started: boolean; // a place saved or a session finished: Resume, not Start
  next: string | null; // where the book opens; null once every session is finished
  chapters: {
    chapterId: string;
    title: string;
    // S06: its checkpoint, once asked for; whether its latest attempt passed.
    checkpoint: { state: CheckpointState; passed: boolean | null } | null;
    sessions: {
      sessionId: string;
      title: string;
      minutes: number;
      finished: boolean;
    }[];
  }[];
};
export type BookNext = {
  bookId: string;
  bookTitle: string;
  chapterTitle: string;
  sessionId: string;
  title: string;
  minutes: number;
  firstPage: number;
  lastPage: number;
  place: number; // 1-based, across the book
  of: number;
};
export type BookReading = {
  bookId: string;
  bookTitle: string;
  chapterTitle: string;
  sessionId: string;
  title: string;
  minutes: number;
  // The section's own pages in the PDF, shown by the reader (Q-P2-31, updated).
  firstPage: number;
  lastPage: number;
  finished: boolean;
  fraction: number | null; // where the user left off in this session
  previous: string | null;
  next: string | null;
  place: number; // 1-based, across the book
  of: number;
};

// P2-W12-S01 (§5H, ADR-0024): GitHub, through Interval's GitHub App. Only who the user
// is on GitHub and which installations they can reach; never a stored token.
export type GitHubInstallation = {
  installationId: string;
  accountLogin: string; // the user's own account, or an organisation's
  accountType: "User" | "Organization";
};
export interface GitHub {
  // The authorizing user's access token for a callback's code; throws when GitHub
  // refuses it.
  exchange(code: string): Promise<string>;
  user(token: string): Promise<{ id: string; login: string }>;
  // This App's installations the user can reach, by GitHub's own answer (a callback's
  // installation_id can be forged).
  installations(token: string): Promise<GitHubInstallation[]>;
  // S02: the repositories on an installation this user can reach (for an
  // organisation's, the App reads more than a member may see).
  reachableRepositories(
    token: string,
    installationId: string,
  ): Promise<string[]>;
  // Done with the user's token: GitHub forgets it (nothing long-lived, ADR-0024).
  revoke(token: string): Promise<void>;
}
export type GitHubConnection = {
  login: string;
  connectedAt: Date;
  installations: GitHubInstallation[];
  // S02: what the worker last read, and how long ago (by the database's clock); null
  // before the first read.
  syncedMinutesAgo: number | null;
  repositories: {
    fullName: string;
    languages: string[];
    dependencies: number;
    technologies: string[]; // what its dependencies map to (the curated table, PER-4)
  }[];
};
export interface GitHubAccounts {
  // Replaces the user's GitHub account and installations; a GitHub account connected
  // to another Interval account moves here.
  connect(
    userId: string,
    account: { githubUserId: string; login: string },
    installations: GitHubInstallation[],
    // S02: per organisation installation, the repository ids this user can reach.
    reachable: Record<string, string[]>,
  ): Promise<void>;
  // True when there was a connection to remove.
  disconnect(userId: string): Promise<boolean>;
  get(userId: string): Promise<GitHubConnection | null>;
}

// P2-W12-S03 (PER-4, AI-3): the owner's review of LLM-suggested technologies for
// packages the curated table doesn't claim.
export type TechnologySuggestionRow = {
  id: string;
  ecosystem: "npm" | "pypi" | "go";
  package: string;
  users: number;
  name: string;
  slug: string;
  concepts: { slug: string; name: string }[];
  model: string;
};
// P3-W13-S05 (ADR-0031): the daily challenge's sets, for the owner's review the day
// before. Days are UTC dates, "YYYY-MM-DD".
export type DailySetQuestion = {
  position: number;
  questionId: string;
  kind: "choice" | "estimate";
  stem: string;
  status: QuestionStatus; // a question that left the bank since is passed over
  concepts: string[];
  source: string; // its article's title, or a hand-written question's page's
};
export type DailySet = {
  day: string;
  approved: boolean;
  publishedUnreviewed: boolean; // went out without approval (ADR-0031)
  questions: DailySetQuestion[];
};
export interface AdminDaily {
  // Today's set and tomorrow's; null for a day not picked yet.
  sets(): Promise<{ today: DailySet | null; tomorrow: DailySet | null }>;
  // False for a day that has started or has no set.
  approve(day: string): Promise<boolean>;
  // Another question of the slot's kind by the pick rule (daily_challenge_swap);
  // false for a started day, an empty slot, or when nothing fits.
  swap(day: string, position: number): Promise<boolean>;
}
// P3-W14-S03 (ADR-0032): the owner tidies typed universities. Each acts on typed rows
// only; listed ones come from the seed.
export interface AdminUniversities {
  // Typed universities with how many players have them, most first.
  typed(): Promise<{ id: string; name: string; members: number }[]>;
  // "taken": another university has that name (merge instead). `name` is checked by
  // universityName.
  rename(id: string, name: string): Promise<"renamed" | "missing" | "taken">;
  // Its players move to `intoId` with their clocks as they were; the typed row goes.
  // The players moved (for their boards, P3-W14-S04); null when refused.
  merge(id: string, intoId: string): Promise<string[] | null>;
  // Its players are left with none, their clocks as they were; the players, or null.
  remove(id: string): Promise<string[] | null>;
}
// P3-W18-S02 (§6.9, ADR-0006 C-14, Q-P3-20): a player flagged for review by their
// signals in a live match (an answer under 400 ms, a focus change in a live round).
export type FairPlaySignal = {
  kind: "speed" | "focus";
  round: number;
  ms: number | null;
};
export type FairPlayFlagRow = {
  id: string;
  userId: string;
  player: string; // their username, else their name (a guest)
  matchId: string;
  mode: GameMode;
  playedAt: Date;
  signals: FairPlaySignal[];
  gain: number; // the rating the match gained them: what a penalty would remove
};
// Flags go to review before any penalty; a penalty removes the match's gain from the
// player's rating and drops their ghost run of it, never touching the account (owner,
// 2026-11-05).
export interface AdminFairPlay {
  pending(): Promise<FairPlayFlagRow[]>;
  // The flagged player, or null when the flag isn't pending (decided already).
  decide(
    flagId: string,
    adminUserId: string,
    decision: "dismiss" | "penalize",
  ): Promise<{ userId: string } | null>;
}

export interface AdminTechnologies {
  pending(): Promise<TechnologySuggestionRow[]>;
  // Stored dependencies no live technology claims, most used first.
  unclaimed(
    limit: number,
  ): Promise<{ ecosystem: string; package: string; users: number }[]>;
  coverage(): Promise<{
    technologies: number;
    packages: number;
    dependencies: number; // distinct stored dependency names
    resolved: number; // of those, claimed by a live technology
  }>;
  // The suggestion's technology (a live slug gains the package), its package and its
  // concepts. "decided": not pending any more; "conflict": its slug is a retired
  // technology, or something claims the package now (nothing changes).
  accept(
    suggestionId: string,
    adminUserId: string,
  ): Promise<"accepted" | "decided" | "conflict">;
  reject(suggestionId: string, adminUserId: string): Promise<boolean>;
}

// Concept explainers (§5G, ADR-0038, P4-W22-S01): scripts waiting for the owner, each
// with its citations as the sections they quote (deep links, §3.2).
export type ExplainerReview = {
  id: string;
  concept: string;
  script: string;
  model: string;
  createdAt: Date;
  // Cited sections gone since (re-segmented): not shown, but counted.
  missing: number;
  citations: {
    momentId: string;
    articleTitle: string;
    sectionTitle: string;
    link: string;
  }[];
};
export interface AdminExplainers {
  pending(): Promise<ExplainerReview[]>;
  // False: not pending any more (decided already, or no such script), or approving one
  // that no longer has two sources to cite (AI-1).
  decide(
    id: string,
    decision: "approved" | "rejected",
    by: string,
  ): Promise<boolean>;
}

// P4.5-W26-S02 (AI-1, Q-P4.5-03): drafted scene timelines, each approved or rejected by
// the owner before a player shows it. The timeline itself is a file in the media bucket
// (`key`); the captions are the voiced explainer's, which its steps are anchored to.
export type PendingScene = {
  id: string;
  concept: string;
  key: string;
  model: string;
  captions: Caption[];
};

export interface AdminScenes {
  pending(): Promise<PendingScene[]>;
  // A pending scene, for the decision; null once decided or gone.
  scene(id: string): Promise<PendingScene | null>;
  // False: not pending any more.
  decide(
    id: string,
    decision: "approved" | "rejected",
    by: string,
  ): Promise<boolean>;
}

// The audio queue (§5G, §5I, P4-W23-S01): voiced explainers a listener queued, where
// they are in each, and Up next along the concept graph (wireframe 07). Per account,
// shared by the PWA and the app.
export interface Listening {
  // Approved, voiced explainers of what the reader shows: the section's concepts, or the
  // article's when no section was reached. By concept name.
  voiced(itemId: string, momentId: string | null): Promise<string[]>;
  queue(userId: string): Promise<ListenResponse>;
  // Appended in order; ones already queued stay where they are.
  add(userId: string, explainerIds: string[]): Promise<void>;
  remove(userId: string, explainerId: string): Promise<boolean>;
  // null: no voiced explainer by that id. new: no unfinished listen was under way.
  start(
    userId: string,
    explainerId: string,
  ): Promise<{ conceptId: string; new: boolean } | null>;
  // False: no listen under way (not started, or finished).
  save(userId: string, explainerId: string, seconds: number): Promise<boolean>;
  // Finished, back to 0, and out of the queue; null: no such voiced explainer. new:
  // false when it was already finished (a retried finish).
  finish(
    userId: string,
    explainerId: string,
  ): Promise<{ conceptId: string; new: boolean } | null>;
}

// Opt-in pushes (Q-P4-13, P4-W24-S01): which kinds, the hour, and the device's zone.
export type PushKind = "digest" | "path_reminder" | "daily_challenge";
export interface PushSettings {
  // Defaults (all off, 18:00) for a user who never saved.
  get(userId: string): Promise<PushPreferences>;
  // Saved with the zone; the kinds turned on or off by this save.
  save(
    userId: string,
    preferences: PushPreferences,
    timeZone: string,
  ): Promise<{ kind: PushKind; on: boolean }[]>;
}

// The pronunciation dictionary (TTS-2, Q-P4-10, P4-W22-S02): the seed's terms and the
// admin's, which the admin page adds and removes (the seed's change in the YAML file).
export type PronunciationRow = {
  id: string;
  term: string;
  say: string;
  origin: "seed" | "admin";
};
export interface AdminPronunciations {
  list(): Promise<PronunciationRow[]>;
  // "taken": the term is in the dictionary already, in any case.
  add(term: string, say: string, by: string): Promise<"added" | "taken">;
  // False: no such admin-added term (a seed term stays).
  remove(id: string): Promise<boolean>;
}

// The TTS blind test (TTS-1, Q-P4-07, P4-W22-S03): the latest run's voices per script,
// unnamed until every script has the owner's pick (owner, 2026-11-09).
export type TtsVoice = {
  id: string;
  label: "A" | "B" | "C";
  picked: boolean;
  // Null until the run is revealed: the page can't show what it isn't given.
  provider: string | null;
};
export type TtsRun = {
  run: string;
  // A newer run stopped part way (the budget, or a provider failing): not shown.
  newerStopped: boolean;
  scripts: { scriptNo: number; voices: TtsVoice[] }[];
  revealed: boolean;
  tally: { provider: string; picks: number }[];
};
export interface AdminTts {
  latest(): Promise<TtsRun | null>;
  // False: its script has a pick already (even one made at the same moment).
  pick(sampleId: string, by: string): Promise<boolean>;
  // A sample's stored audio, for the admin-only audio route.
  fileKey(sampleId: string): Promise<string | null>;
}

// P5-W31-S01 (LLDQ-4, DB-6): LLD battle problems as loaded into Postgres. The row holds
// what a player may see; the hidden layers live in the private bucket at privateKey.
// Shapes from the problem contract (packages/lld), not repeated here.
export type LoadedProblem = Pick<
  Problem,
  "slug" | "title" | "difficulty" | "interface" | "limits"
> & {
  statement: string;
  checks: NonNullable<Problem["checks"]>;
  // The visible scenarios with their expected results, in the problem's order.
  visible: { scenario: Scenario; results: ResultLine[] }[];
  // The extension round (P5-W31-S02a): shown only after the reveal; null without one.
  extension: { statement: string; interface: Interface } | null;
  privateKey: string;
  contentHash: string;
};

export interface ProblemStore {
  // The live problems (not retired): slug to content hash.
  hashes(): Promise<Map<string, string>>;
  // A live problem, or null when there's none by that slug or it's retired.
  get(slug: string): Promise<LoadedProblem | null>;
  // Insert or replace by slug; a retired problem loaded again is live again.
  save(problem: LoadedProblem): Promise<void>;
  retire(slugs: string[]): Promise<void>;
}
