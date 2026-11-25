import { expect, test, vi } from "vitest";
import type { Topic } from "@interval/db";
import type { PreferencesStore } from "./ports";
import {
  completeOnboarding,
  offeredTopics,
  updatePreferences,
} from "./preferences";

// §5A, C-21, P1-W4-S01: one screen, three fields, and no way past it without a topic.
const GOAL = { goals: ["system-design-interviews"] };
const LAUNCH: Topic[] = [
  "system-design",
  "databases",
  "distributed-systems",
  "backend",
];
function store() {
  return {
    get: vi.fn<PreferencesStore["get"]>(() => Promise.resolve(null)),
    createIfAbsent: vi.fn(() => Promise.resolve(true)),
    update: vi.fn(() => Promise.resolve(true)),
  } satisfies PreferencesStore;
}

test("choices are kept as the user's explicit preferences", async () => {
  const preferences = store();
  const result = await completeOnboarding(
    preferences,
    "u1",
    {
      goals: ["system-design-interviews"],
      topics: ["databases", "backend"],
      level: "intermediate",
      breakLength: "3-8",
    },
    LAUNCH,
  );
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
    "an unknown goal",
    {
      goals: ["world-peace"],
      topics: ["backend"],
      level: "beginner",
      breakLength: "1-3",
    },
    "goal",
  ],
])("%s is refused and nothing is kept", async (_case, input, field) => {
  const preferences = store();
  const result = await completeOnboarding(preferences, "u1", input, LAUNCH);
  expect(result).toEqual({ ok: false, field });
  expect(preferences.createIfAbsent).not.toHaveBeenCalled();
});

test("a topic picked twice is kept once", async () => {
  const preferences = store();
  await completeOnboarding(
    preferences,
    "u1",
    {
      goals: ["system-design-interviews"],
      topics: ["backend", "backend"],
      level: "advanced",
      breakLength: "8-15",
    },
    LAUNCH,
  );
  expect(preferences.createIfAbsent).toHaveBeenCalledWith(
    "u1",
    expect.objectContaining({ topics: ["backend"] }),
  );
});

test("goals are kept once each, in the order the store reads them back", async () => {
  const preferences = store();
  await completeOnboarding(
    preferences,
    "u1",
    {
      goals: ["stay-sharp", "system-design-interviews", "stay-sharp"],
      topics: ["backend"],
      level: "beginner",
      breakLength: "1-3",
    },
    LAUNCH,
  );
  expect(preferences.createIfAbsent).toHaveBeenCalledWith(
    "u1",
    expect.objectContaining({
      goals: ["system-design-interviews", "stay-sharp"],
    }),
  );
});

// ADR-0049 (option 2): the launch topics always; software design once it has reading,
// so no one picks a topic with nothing to read.
test("a topic past the launch four is offered once it has reading", async () => {
  const none = { topicsWithReading: () => Promise.resolve([]) };
  expect(await offeredTopics(none)).toEqual(LAUNCH);
  const some = {
    topicsWithReading: (): Promise<Topic[]> =>
      Promise.resolve(["software-design", "databases"]),
  };
  expect(await offeredTopics(some)).toEqual([...LAUNCH, "software-design"]);
});

// ADR-0049: a topic that isn't offered can't be saved by a forged form, though a topic
// the user already has stays theirs (PER-1).
const CHOICES = { ...GOAL, level: "beginner", breakLength: "1-3" };
test("onboarding refuses a topic that isn't offered", async () => {
  const preferences = store();
  const input = { ...CHOICES, topics: ["backend", "software-design"] };
  expect(await completeOnboarding(preferences, "u1", input, LAUNCH)).toEqual({
    ok: false,
    field: "topic-unavailable",
  });
  expect(preferences.createIfAbsent).not.toHaveBeenCalled();
  const offered: Topic[] = [...LAUNCH, "software-design"];
  expect(await completeOnboarding(preferences, "u1", input, offered)).toEqual({
    ok: true,
    created: true,
  });
});

test("Profile refuses a topic that isn't offered unless the user already has it", async () => {
  const preferences = store();
  const input = { ...CHOICES, topics: ["software-design"] };
  expect(await updatePreferences(preferences, "u1", input, LAUNCH)).toEqual({
    ok: false,
    field: "topic-unavailable",
  });
  expect(preferences.update).not.toHaveBeenCalled();
  preferences.get.mockImplementation(() =>
    Promise.resolve({
      goals: ["system-design-interviews"],
      topics: ["software-design"],
      level: "beginner",
      breakLength: "1-3",
      onboardedAt: new Date(0),
      firstName: null,
    }),
  );
  expect(await updatePreferences(preferences, "u1", input, LAUNCH)).toEqual({
    ok: true,
    updated: true,
  });
});
