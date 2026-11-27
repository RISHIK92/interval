// About 20 seconds a question: the review queue's time estimate (wireframe 08), as
// the Library's card and the feed's review card show it.
const SECONDS_EACH = 20;

export function reviewMinutes(concepts: number): number {
  return Math.max(1, Math.ceil((concepts * SECONDS_EACH) / 60));
}

// ADR-0044: how many of `due` fit a break of `minutes` at the same estimate.
export function reviewsFitting(due: number, minutes: number): number {
  return Math.min(due, Math.floor((minutes * 60) / SECONDS_EACH));
}
