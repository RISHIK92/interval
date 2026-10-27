import type { LearnerState } from "@interval/db";

// §3.1's learner states in words, shown beside a concept (never colour alone). No row
// is unseen.
export const STATE_WORDS: Record<LearnerState, string> = {
  explored: "Explored",
  practiced: "Practiced",
  mastered: "Mastered",
  due_for_review: "Due for review",
};
