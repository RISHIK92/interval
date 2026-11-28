import { z } from "zod";
import type { Topic } from "@interval/db";
import {
  type FeedReader,
  GOALS,
  LAUNCH_TOPICS,
  LEVELS,
  LIVE_GOALS,
  type Preferences,
  type PreferencesStore,
  TOPICS,
} from "./ports";

// §5A, PER-1, C-21, P1-W4-S01, ADR-0015: onboarding asks for goals and topics (at least
// one of each) and a level, and keeps them as the user's explicit choices. ADR-0058: no
// break length; one an old form still sends is ignored.

// "topic-unavailable": a topic that isn't offered (ADR-0049), apart from none at all.
type OnboardingField = "goal" | "topic" | "topic-unavailable" | "level";
// `created` is false when the user had already onboarded: nothing was changed.
type OnboardingResult =
  { ok: true; created: boolean } | { ok: false; field: OnboardingField };

// ADR-0049 (option 2): the topics onboarding and Profile offer, in display order. A
// topic past the launch four waits for reading from sources tagged with it.
export async function offeredTopics(
  feed: Pick<FeedReader, "topicsWithReading">,
): Promise<Topic[]> {
  const withReading = new Set(await feed.topicsWithReading());
  return TOPICS.filter(
    (t) => LAUNCH_TOPICS.some((launch) => launch === t) || withReading.has(t),
  );
}

// ADR-0015: at least one goal, and only the goals that work now.
const schema = z.object({
  goals: z.array(z.enum(LIVE_GOALS)).min(1),
  topics: z.array(z.enum(TOPICS)).min(1),
  level: z.enum(LEVELS),
});

type Input = {
  goals: string[];
  topics: string[];
  level: string;
};

// The same rules at onboarding and on the Profile page (P1-W4-S08). `allowed` is the
// offered topics plus any the user already has (ADR-0049, PER-1): a forged form can't
// add a topic that isn't offered.
function parsePreferences(
  input: Input,
  allowed: readonly Topic[],
):
  | { ok: true; preferences: Preferences }
  | { ok: false; field: OnboardingField } {
  const parsed = schema.safeParse({
    goals: [...new Set(input.goals)],
    topics: [...new Set(input.topics)],
    level: input.level,
  });
  if (parsed.success && !parsed.data.topics.every((t) => allowed.includes(t)))
    return { ok: false, field: "topic-unavailable" };
  if (parsed.success) {
    // Kept in the enum's order, as the store reads them back.
    const goals = GOALS.filter((g) => parsed.data.goals.some((c) => c === g));
    return { ok: true, preferences: { ...parsed.data, goals } };
  }
  const path = parsed.error.issues[0]?.path[0];
  const field: OnboardingField =
    path === "goals" ? "goal" : path === "topics" ? "topic" : "level";
  return { ok: false, field };
}

export async function completeOnboarding(
  store: PreferencesStore,
  userId: string,
  input: Input,
  offered: readonly Topic[],
): Promise<OnboardingResult> {
  const parsed = parsePreferences(input, offered);
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    created: await store.createIfAbsent(userId, parsed.preferences),
  };
}

// Explicit choices only (PER-1): nothing inferred is touched.
export async function updatePreferences(
  store: PreferencesStore,
  userId: string,
  input: Input,
  offered: readonly Topic[],
): Promise<
  { ok: true; updated: boolean } | { ok: false; field: OnboardingField }
> {
  const saved = (await store.get(userId))?.topics ?? [];
  const parsed = parsePreferences(input, [...offered, ...saved]);
  if (!parsed.ok) return parsed;
  // `updated` is false before onboarding: there were no choices to edit.
  return { ok: true, updated: await store.update(userId, parsed.preferences) };
}
