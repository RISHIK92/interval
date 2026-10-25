import { z } from "zod";
import { BREAK_LENGTHS, LEVELS, type PreferencesStore, TOPICS } from "./ports";

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

export async function completeOnboarding(
  store: PreferencesStore,
  userId: string,
  input: { topics: string[]; level: string; breakLength: string },
): Promise<OnboardingResult> {
  const parsed = schema.safeParse({
    ...input,
    topics: [...new Set(input.topics)],
  });
  if (!parsed.success) {
    const path = parsed.error.issues[0]?.path[0];
    const field: OnboardingField =
      path === "topics" ? "topic" : path === "level" ? "level" : "break";
    return { ok: false, field };
  }
  return { ok: true, created: await store.createIfAbsent(userId, parsed.data) };
}
