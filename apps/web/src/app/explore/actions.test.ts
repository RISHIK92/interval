import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type {
  Actor,
  Explore,
  JobQueue,
  Preferences,
  PreferencesStore,
} from "../../server/ports";

// ADR-0046: following a space is choosing its topic (PER-1); the gap card's dismissal.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const get = vi.fn<(userId: string) => Promise<Preferences | null>>();
const update = vi.fn<PreferencesStore["update"]>(() => Promise.resolve(true));
const enqueue = vi.fn<JobQueue["enqueue"]>(() => Promise.resolve());
const dismissGap = vi.fn<Explore["dismissGap"]>(() => Promise.resolve());
const emit = vi.fn();
vi.mock("../../server/container", () => ({
  sessionReader: () => ({ current }),
  preferences: () => ({ get, update }),
  jobQueue: () => ({ enqueue }),
  explore: () => ({ dismissGap }),
  events: () => ({ emit }),
  feedReader: () => ({ topicsWithReading: () => Promise.resolve([]) }),
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
  cookies: () => Promise.resolve({ get: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const ada: Actor = { userId: "u1", isGuest: false, betaGroup: null };
const chosen: Preferences = {
  goals: ["stay-sharp"],
  topics: ["databases"],
  level: "beginner",
};

beforeEach(() => {
  current.mockResolvedValue(ada);
  get.mockResolvedValue(chosen);
});
afterEach(() => {
  vi.clearAllMocks();
});

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

test("following a space adds its topic, recomputes the feed and counts it", async () => {
  const { followSpaceAction } = await import("./actions");
  await expect(
    followSpaceAction(form({ topic: "backend", follow: "true", back: "all" })),
  ).rejects.toThrow("redirect:/explore?spaces=all");
  expect(update).toHaveBeenCalledWith("u1", {
    ...chosen,
    topics: ["databases", "backend"],
  });
  expect(enqueue).toHaveBeenCalledWith(
    "recompute_feed",
    { user_id: "u1" },
    expect.objectContaining({ idempotencyKey: expect.any(String) as string }),
  );
  expect(emit).toHaveBeenCalledWith(
    "space_followed",
    { topic: "backend" },
    expect.objectContaining({ userId: "u1" }),
  );
});

test("the last space can't be unfollowed, nor a topic not offered followed", async () => {
  const { followSpaceAction } = await import("./actions");
  await expect(
    followSpaceAction(form({ topic: "databases", follow: "false" })),
  ).rejects.toThrow("redirect:/explore");
  await expect(
    followSpaceAction(form({ topic: "software-design", follow: "true" })),
  ).rejects.toThrow("redirect:/explore");
  await expect(
    followSpaceAction(form({ topic: "nope", follow: "true" })),
  ).rejects.toThrow("redirect:/explore");
  expect(update).not.toHaveBeenCalled();
  expect(emit).not.toHaveBeenCalled();
});

test("a guest can't follow; a dismissed gap is stored and counted", async () => {
  const { dismissGapAction, followSpaceAction } = await import("./actions");
  current.mockResolvedValueOnce({ ...ada, isGuest: true });
  await expect(
    followSpaceAction(form({ topic: "backend", follow: "true" })),
  ).rejects.toThrow("redirect:/sign-up");
  await expect(dismissGapAction(form({ concept: "77" }))).rejects.toThrow(
    "redirect:/explore",
  );
  expect(dismissGap).toHaveBeenCalledWith("u1", "77");
  expect(emit).toHaveBeenCalledWith(
    "gap_dismissed",
    { concept_id: "77" },
    expect.objectContaining({ userId: "u1" }),
  );
  await expect(dismissGapAction(form({ concept: "x" }))).rejects.toThrow(
    "redirect:/explore",
  );
  expect(dismissGap).toHaveBeenCalledTimes(1);
});
