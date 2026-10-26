import type { Chip } from "./chips";
import type { FeedCard, FeedReader, Preferences } from "./ports";

// ADR-0008: a new guest's first page waits up to about 3 seconds for their feed's first
// recompute (queued when onboarding saved), then shows the starter feed instead. Only
// just after onboarding: a feed that never lands must not slow every later page.
const FIRST_VISIT_WAIT_MS = 3000;
const POLL_MS = 250;
const NEW_GUEST_MS = 2 * 60_000;

const pause = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export async function loadFeed(
  deps: {
    feed: FeedReader;
    sleep?: (ms: number) => Promise<void>;
    now?: () => Date;
  },
  userId: string,
  preferences: Preferences & { onboardedAt: Date },
  chip: Chip,
  limit: number,
): Promise<{ cards: FeedCard[] }> {
  const sleep = deps.sleep ?? pause;
  const now = deps.now ?? (() => new Date());
  const newGuest =
    now().getTime() - preferences.onboardedAt.getTime() < NEW_GUEST_MS;
  let read = await deps.feed.read(userId, chip, limit);
  let waited = 0;
  while (newGuest && !read.computed && waited < FIRST_VISIT_WAIT_MS) {
    await sleep(POLL_MS);
    waited += POLL_MS;
    read = await deps.feed.read(userId, chip, limit);
  }
  if (read.computed) return { cards: read.cards };
  const [topic] = preferences.topics;
  if (topic === undefined) return { cards: [] };
  return {
    cards: await deps.feed.starter(
      userId,
      topic,
      preferences.level,
      chip,
      limit,
    ),
  };
}
