import { z } from "zod";
import {
  BREAK_LENGTHS,
  GOALS,
  LEVELS,
  LIVE_GOALS,
  type Preferences,
  type PreferencesStore,
  TOPICS,
} from "./ports";

// §5A, PER-1, C-21, P1-W4-S01, ADR-0015: onboarding asks for goals and topics (at least
// one of each), a level and a break length, and keeps them as the user's explicit
// choices.

export type OnboardingField = "goal" | "topic" | "level" | "break";
// `created` is false when the user had already onboarded: nothing was changed.
export type OnboardingResult =
  { ok: true; created: boolean } | { ok: false; field: OnboardingField };

// ADR-0015: at least one goal, and only the goals that work now.
const schema = z.object({
  goals: z.array(z.enum(LIVE_GOALS)).min(1),
  topics: z.array(z.enum(TOPICS)).min(1),
  level: z.enum(LEVELS),
  breakLength: z.enum(BREAK_LENGTHS),
});

type Input = {
  goals: string[];
  topics: string[];
  level: string;
  breakLength: string;
};

// The same rules at onboarding and on the Profile page (P1-W4-S08).
function parsePreferences(
  input: Input,
):
  | { ok: true; preferences: Preferences }
  | { ok: false; field: OnboardingField } {
  const parsed = schema.safeParse({
    ...input,
    goals: [...new Set(input.goals)],
    topics: [...new Set(input.topics)],
  });
  if (parsed.success) {
    // Kept in the enum's order, as the store reads them back.
    const goals = GOALS.filter((g) => parsed.data.goals.some((c) => c === g));
    return { ok: true, preferences: { ...parsed.data, goals } };
  }
  const path = parsed.error.issues[0]?.path[0];
  const field: OnboardingField =
    path === "goals"
      ? "goal"
      : path === "topics"
        ? "topic"
        : path === "level"
          ? "level"
          : "break";
  return { ok: false, field };
}

export async function completeOnboarding(
  store: PreferencesStore,
  userId: string,
  input: Input,
): Promise<OnboardingResult> {
  const parsed = parsePreferences(input);
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
): Promise<
  { ok: true; updated: boolean } | { ok: false; field: OnboardingField }
> {
  const parsed = parsePreferences(input);
  if (!parsed.ok) return parsed;
  // `updated` is false before onboarding: there were no choices to edit.
  return { ok: true, updated: await store.update(userId, parsed.preferences) };
}
