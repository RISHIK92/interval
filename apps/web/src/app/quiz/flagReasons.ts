import type { FlagReason } from "@interval/db";

// P2-W9-S07 (Q-P2-18): why a user flags a question, in the words they pick from;
// every value of the database's flag_reason, and only those.
export const FLAG_REASONS = {
  wrong_key: "The answer marked right is wrong",
  unclear: "The question is unclear",
  not_in_section: "The section doesn't answer it",
  other: "Something else",
} as const satisfies Record<FlagReason, string>;
export type FlagReasonKey = keyof typeof FLAG_REASONS;
export const FLAG_REASON_KEYS = Object.keys(FLAG_REASONS) as [
  FlagReasonKey,
  ...FlagReasonKey[],
];
