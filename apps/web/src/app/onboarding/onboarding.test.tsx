import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type { Actor, Preferences } from "../../server/ports";

// §5A, PER-1, C-21, P1-W4-S01.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const get = vi.fn<(userId: string) => Promise<Preferences | null>>();
const createIfAbsent = vi.fn<
  (userId: string, preferences: Preferences) => Promise<boolean>
>(() => Promise.resolve(true));
const emit = vi.fn();
const enqueue = vi.fn<() => Promise<void>>(() => Promise.resolve());
vi.mock("../../server/container", () => ({
  sessionReader: () => ({ current }),
  preferences: () => ({ get, createIfAbsent }),
  events: () => ({ emit }),
  jobQueue: () => ({ enqueue }),
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === "iv_visit" ? { name, value: "visit-1.1790000000" } : undefined,
    }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const guest: Actor = { userId: "g1", isGuest: true, betaGroup: "student" };

afterEach(() => {
  vi.clearAllMocks();
});

async function page(query: Record<string, string> = {}): Promise<string> {
  const { default: Onboarding } = await import("./page");
  return renderToStaticMarkup(
    await Onboarding({ searchParams: Promise.resolve(query) }),
  );
}

// A goal unless the test says otherwise (ADR-0015 needs one).
function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    goal: "system-design-interviews",
    ...fields,
  })) {
    for (const v of [value].flat()) data.append(key, v);
  }
  return data;
}

test("a new account gets one screen with the four fields", async () => {
  current.mockResolvedValue(guest);
  get.mockResolvedValue(null);
  const html = await page();
  expect(html.match(/name="topic"/g)).toHaveLength(4);
  expect(html.match(/name="level"/g)).toHaveLength(3);
  expect(html.match(/name="breakLength"/g)).toHaveLength(3);
});

test("a returning guest skips onboarding", async () => {
  current.mockResolvedValue(guest);
  get.mockResolvedValue({
    goals: ["system-design-interviews"],
    topics: ["backend"],
    level: "beginner",
    breakLength: "1-3",
  });
  await expect(page()).rejects.toThrow(/^redirect:\/$/);
});

test("without a session there is no onboarding", async () => {
  current.mockResolvedValue(null);
  await expect(page()).rejects.toThrow("redirect:/join");
});

test("choices are saved, onboarding_completed is emitted, and the feed follows", async () => {
  current.mockResolvedValue(guest);
  const { onboardingAction } = await import("./actions");
  await expect(
    onboardingAction(
      form({
        topic: ["databases", "backend"],
        level: "intermediate",
        breakLength: "3-8",
      }),
    ),
  ).rejects.toThrow(/^redirect:\/$/);
  expect(createIfAbsent).toHaveBeenCalledWith("g1", {
    goals: ["system-design-interviews"],
    topics: ["databases", "backend"],
    level: "intermediate",
    breakLength: "3-8",
  });
  expect(emit).toHaveBeenCalledWith(
    "onboarding_completed",
    {},
    expect.objectContaining({ userId: "g1", sessionId: "visit-1" }),
  );
  // The first feed is computed now (ADR-0008); the home page waits briefly for it.
  expect(enqueue).toHaveBeenCalledWith(
    "recompute_feed",
    { user_id: "g1" },
    { idempotencyKey: "onboarding-recompute-g1" },
  );
});

test("a resubmit after onboarding changes and counts nothing", async () => {
  current.mockResolvedValue(guest);
  createIfAbsent.mockResolvedValueOnce(false);
  const { onboardingAction } = await import("./actions");
  await expect(
    onboardingAction(
      form({ topic: "backend", level: "advanced", breakLength: "8-15" }),
    ),
  ).rejects.toThrow(/^redirect:\/$/);
  expect(emit).not.toHaveBeenCalled();
});

test("there is no way past it without a topic", async () => {
  current.mockResolvedValue(guest);
  const { onboardingAction } = await import("./actions");
  await expect(
    onboardingAction(form({ level: "beginner", breakLength: "1-3" })),
  ).rejects.toThrow("redirect:/onboarding?missing=topic");
  expect(createIfAbsent).not.toHaveBeenCalled();
  expect(emit).not.toHaveBeenCalled();
  get.mockResolvedValue(null);
  expect(await page({ missing: "topic" })).toContain(
    "Pick at least one topic.",
  );
});

// LOAD-5: the queue being down must not lose the onboarding or its event; the starter
// feed shows meanwhile and the hourly pass computes the user's feed.
test("a failed recompute enqueue is logged, and onboarding still completes", async () => {
  current.mockResolvedValue(guest);
  enqueue.mockRejectedValueOnce(new Error("valkey down"));
  const lines: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    lines.push(String(chunk));
    return true;
  });
  const { onboardingAction } = await import("./actions");
  await expect(
    onboardingAction(
      form({ topic: "databases", level: "beginner", breakLength: "1-3" }),
    ),
  ).rejects.toThrow(/^redirect:\/$/);
  expect(emit).toHaveBeenCalledWith(
    "onboarding_completed",
    {},
    expect.objectContaining({ userId: "g1" }),
  );
  expect(lines.join("")).toContain("feed: first recompute not queued");
  vi.restoreAllMocks();
});

// ADR-0015: goals first; the two that need Phase 2 are shown but can't be picked.
test("onboarding asks for goals first, with the coming-soon ones disabled", async () => {
  current.mockResolvedValue(guest);
  get.mockResolvedValue(null);
  const html = await page();
  expect(html.indexOf('name="goal"')).toBeLessThan(
    html.indexOf('name="topic"'),
  );
  expect(html.match(/name="goal"/g)).toHaveLength(4);
  for (const goal of ["stack-i-use", "finish-that-book"]) {
    expect(html).toMatch(
      new RegExp(
        `<input[^>]*disabled=""[^>]*value="${goal}"|<input[^>]*value="${goal}"[^>]*disabled=""`,
      ),
    );
  }
  expect(html.match(/Coming soon/g)).toHaveLength(2);
});
