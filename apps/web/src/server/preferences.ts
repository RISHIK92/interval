import { z } from "zod";
import {
  BREAK_LENGTHS,
  LEVELS,
  type Preferences,
  type PreferencesStore,
  TOPICS,
} from "./ports";

// §5A, PER-1, C-21, P1-W4-S01: onboarding asks for topics (at least one), a level and
// a break length, and keeps them as the user's explicit choices.

export type OnboardingField = "topic" | "level" | "break";
// `created` is false when the user had already onboarded: nothing was changed.
export type OnboardingResult =
  { ok: true; created: boolean } | { ok: false; field: OnboardingField };

const schema = z.object({
  topics: z.array(z.enum(TOPICS)).min(1),
  level: z.enum(LEVELS),
  breakLength: z.enum(BREAK_LENGTHS),
});

type Input = { topics: string[]; level: string; breakLength: string };

// The same rules at onboarding and on the Profile page (P1-W4-S08).
function parsePreferences(
  input: Input,
):
  | { ok: true; preferences: Preferences }
  | { ok: false; field: OnboardingField } {
  const parsed = schema.safeParse({
    ...input,
    topics: [...new Set(input.topics)],
  });
  if (parsed.success) return { ok: true, preferences: parsed.data };
  const path = parsed.error.issues[0]?.path[0];
  const field: OnboardingField =
    path === "topics" ? "topic" : path === "level" ? "level" : "break";
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
