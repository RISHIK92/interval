import type { FlagReason } from "@interval/db";

// P2-W9-S07 (Q-P2-18): why a user flags a question, in the words they pick from;
// every value of the database's flag_reason, and only those.
export const FLAG_REASONS = {
  wrong_key: "The answer marked right is wrong",
  unclear: "The question is unclear",
  // ADR-0058: the database value keeps its name until stage C; it means the article.
  not_in_section: "The article doesn't answer it",
  other: "Something else",
} as const satisfies Record<FlagReason, string>;
type FlagReasonKey = keyof typeof FLAG_REASONS;
export const FLAG_REASON_KEYS = Object.keys(FLAG_REASONS) as [
  FlagReasonKey,
  ...FlagReasonKey[],
];

// ADR-0058: the event names the reason by the article (question_flagged v2), while the
// database's flag_reason still stores the moment-era value.
export const flagEventReason = (
  reason: FlagReasonKey,
): "wrong_key" | "unclear" | "not_in_article" | "other" =>
  reason === "not_in_section" ? "not_in_article" : reason;
