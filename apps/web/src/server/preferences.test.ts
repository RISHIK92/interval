import { expect, test, vi } from "vitest";
import type { PreferencesStore } from "./ports";
import { completeOnboarding } from "./preferences";

// §5A, C-21, P1-W4-S01: one screen, three fields, and no way past it without a topic.
const GOAL = { goals: ["system-design-interviews"] };
function store() {
  return {
    get: vi.fn(() => Promise.resolve(null)),
    createIfAbsent: vi.fn(() => Promise.resolve(true)),
    update: vi.fn(() => Promise.resolve(true)),
  } satisfies PreferencesStore;
}

test("choices are kept as the user's explicit preferences", async () => {
  const preferences = store();
  const result = await completeOnboarding(preferences, "u1", {
    goals: ["system-design-interviews"],
    topics: ["databases", "backend"],
    level: "intermediate",
    breakLength: "3-8",
  });
  expect(result).toEqual({ ok: true, created: true });
  expect(preferences.createIfAbsent).toHaveBeenCalledWith("u1", {
    goals: ["system-design-interviews"],
    topics: ["databases", "backend"],
    level: "intermediate",
    breakLength: "3-8",
  });
});

test.each([
  [
    "no topic",
    { ...GOAL, topics: [], level: "beginner", breakLength: "1-3" },
    "topic",
  ],
  [
    "an unknown topic",
    { ...GOAL, topics: ["cooking"], level: "beginner", breakLength: "1-3" },
    "topic",
  ],
  [
    "no level",
    { ...GOAL, topics: ["backend"], level: "", breakLength: "1-3" },
    "level",
  ],
  [
    "an unknown break",
    { ...GOAL, topics: ["backend"], level: "beginner", breakLength: "20" },
    "break",
  ],
  // ADR-0015: at least one goal, and only the ones that work now.
  [
    "no goal",
    { goals: [], topics: ["backend"], level: "beginner", breakLength: "1-3" },
    "goal",
  ],
  [
    "a coming-soon goal",
    {
      goals: ["stack-i-use"],
      topics: ["backend"],
      level: "beginner",
      breakLength: "1-3",
    },
    "goal",
  ],
])("%s is refused and nothing is kept", async (_case, input, field) => {
  const preferences = store();
  const result = await completeOnboarding(preferences, "u1", input);
  expect(result).toEqual({ ok: false, field });
  expect(preferences.createIfAbsent).not.toHaveBeenCalled();
});

test("a topic picked twice is kept once", async () => {
  const preferences = store();
  await completeOnboarding(preferences, "u1", {
    goals: ["system-design-interviews"],
    topics: ["backend", "backend"],
    level: "advanced",
    breakLength: "8-15",
  });
  expect(preferences.createIfAbsent).toHaveBeenCalledWith(
    "u1",
    expect.objectContaining({ topics: ["backend"] }),
  );
});

test("goals are kept once each, in the order the store reads them back", async () => {
  const preferences = store();
  await completeOnboarding(preferences, "u1", {
    goals: ["stay-sharp", "system-design-interviews", "stay-sharp"],
    topics: ["backend"],
    level: "beginner",
    breakLength: "1-3",
  });
  expect(preferences.createIfAbsent).toHaveBeenCalledWith(
    "u1",
    expect.objectContaining({
      goals: ["system-design-interviews", "stay-sharp"],
    }),
  );
});
