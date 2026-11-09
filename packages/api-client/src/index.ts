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
});
export type ReaderResponse = z.infer<typeof ReaderResponse>;
// As the web's notes (P2-W7-S03).
export const NOTE_MAX = 2000;
