import type { ArticleState } from "../server/ports";

// ADR-0058: the two states an article shows once opened; an unread one shows none.
export function stateLabel(state: ArticleState): string | null {
  if (state === "continue_reading") return "Continue reading";
  if (state === "completed") return "Completed";
  return null;
}
