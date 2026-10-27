// Ports (ADR-0012): what server logic and pages depend on. Adapters implement them;
// container.ts wires them. Nothing outside adapters/ imports kysely or pg.

import type {
  BreakLength,
  Capability,
  Difficulty,
  FeedbackKind,
  LearnerState,
  LearningGoal,
  Topic,
} from "@interval/db";
import type { MessageName, Messages } from "@interval/db/messages";
import type { Envelope } from "@interval/events";

// What a card may show (§3.2, ING-2): no summary or body text. A moment, or in the
// 8–15 chip a whole article (Q-P1-16, P1-W4-S05b).
type CardBase = {
  itemId: string;
  articleTitle: string;
  author: string | null;
  sourceName: string;
  // Why this matters (§5E, P1-W4-S06): `ai` once the notes model wrote it (AI-3).
  note: { text: string; ai: boolean } | null;
  saved: boolean; // the user saved its article (P1-W5-S04)
  // ADR-0018: the publisher's page allows Interval's in-app reader to frame it
  // (false while unknown).
  frameable: boolean;
  topic: Topic | null; // its source's first known topic, for the picture (ADR-0019)
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
  // The note on this entry in the user's feed, if it has one.
  note: FeedCard["note"];
  saved: boolean;
  nextMomentId: string | null; // the section after the one reached, by order
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
export type FinishMethod = "return_prompt" | "mark_done";
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
  options: string[];
  servedAt: Date;
};
export type QuizResult = {
  correct: boolean;
  correctOption: number;
  servedAt: Date;
  answeredAt: Date;
  firstTime: boolean; // false: a resubmission (LOAD-5) given the stored result
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
  // the user's attempt.
  answer(
    userId: string,
    attemptId: string,
    questionId: string,
    chosen: number,
  ): Promise<QuizResult | "late" | null>;
  finish(
    userId: string,
    attemptId: string,
  ): Promise<{ answered: number; correct: number; firstTime: boolean } | null>;
  // P2-W9-S02: which of these targets would start a quiz, as `quizKey` keys.
  offered(
    targets: { itemId: string; momentId: string | null }[],
  ): Promise<Set<string>>;
  // The attempt's header and results; null when it isn't the user's.
  attempt(userId: string, attemptId: string): Promise<QuizAttempt | null>;
  // P2-W9-S05 (Q-P2-17): the concepts due for review that have a live question to
  // ask, most overdue first, up to 10 (one session's worth).
  dueReviews(userId: string): Promise<{ conceptId: string; name: string }[]>;
  // A review session over them, untimed; the running one if there is one; null when
  // nothing is due.
  startReview(userId: string): Promise<{
    attemptId: string;
    concepts: number;
    firstTime: boolean;
  } | null>;
  // A question answered in the user's attempt, key included, for its feedback.
  answered(
    userId: string,
    attemptId: string,
    questionId: string,
  ): Promise<QuizFeedback | null>;
}

export const quizKey = (itemId: string, momentId: string | null): string =>
  `${itemId}.${momentId ?? ""}`;
export type QuizAttempt = {
  // A review session (P2-W9-S05) has no article and no clock.
  review: boolean;
  itemId: string | null;
  momentId: string | null;
  title: string; // the section's, else the article's; "Review" for a review
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
};
export type QuizFeedback = {
  stem: string;
  options: string[];
  chosen: number;
  correctOption: number;
  correct: boolean;
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
  // Null for an unknown email or a wrong password: the caller cannot tell which.
  signIn(
    headers: Headers,
    email: string,
    password: string,
  ): Promise<{ setCookies: string[]; actor: Actor } | null>;
  signOut(headers: Headers): Promise<void>;
  // Mails a reset link if the account exists; returns the same either way.
  requestReset(email: string): Promise<void>;
  // False for an unknown, used or expired token.
  resetPassword(token: string, newPassword: string): Promise<boolean>;
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
  reason: "sample" | "flagged";
  stem: string;
  options: string[];
  correct: number;
  validatorAnswer: number | null;
  citation: string;
  articleTitle: string;
  sectionTitle: string;
  link: string;
};
export interface AdminQuestions {
  // Undecided reviews of questions still live or flagged, the oldest first: one
  // retired meanwhile (a redraft) needs no check.
  open(): Promise<ReviewQuestion[]>;
  // False when there was no undecided review of that question.
  decide(
    questionId: string,
    decision: ReviewDecision,
    by: string,
  ): Promise<boolean>;
}

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

// ADR-0015: learning goals, in the enum's order. Stack and book goals are coming soon
// until Phase 2 (GitHub, PDF books): shown, not selectable (owner, 2026-10-26).
export const GOALS = [
  "system-design-interviews",
  "stack-i-use",
  "finish-that-book",
  "stay-sharp",
] as const satisfies readonly LearningGoal[];
export const LIVE_GOALS = [
  "system-design-interviews",
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
