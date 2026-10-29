import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type {
  Actor,
  Books,
  GitHubAccounts,
  Preferences,
} from "../../server/ports";

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
  books: () => ({ list }),
  githubAccounts: () => ({ get: githubGet }),
}));
const githubGet = vi.fn<GitHubAccounts["get"]>(() => Promise.resolve(null));
const list = vi.fn<Books["list"]>(() => Promise.resolve([]));
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

// The fieldset of each step, in order, with whether it is the one showing.
function steps(html: string): { shown: boolean; html: string }[] {
  return [...html.matchAll(/<fieldset([^>]*)>([\s\S]*?)<\/fieldset>/g)].map(
    ([, attrs = "", inner = ""]) => ({
      shown: !/\bhidden=""/.test(attrs),
      html: inner,
    }),
  );
}

test("a new account gets four steps of one form, every field posted together", async () => {
  current.mockResolvedValue(guest);
  get.mockResolvedValue(null);
  const html = await page();
  // One form holds every step, so the four answers post at once.
  expect(html.match(/<form/g)).toHaveLength(1);
  const form = html.slice(html.indexOf("<form"), html.indexOf("</form>"));
  expect(form.match(/name="goal"/g)).toHaveLength(4);
  expect(form.match(/name="topic"/g)).toHaveLength(4);
  expect(form.match(/name="level"/g)).toHaveLength(3);
  expect(form.match(/name="breakLength"/g)).toHaveLength(3);
  const all = steps(html);
  expect(all).toHaveLength(4);
  expect(all.map((step) => step.shown)).toEqual([true, false, false, false]);
  expect(all[0]?.html).toContain('name="goal"');
  expect(all[3]?.html).toContain('name="breakLength"');
});

// ADR-0016: the account exists before onboarding starts.
test("the first step says the account was created", async () => {
  current.mockResolvedValue(guest);
  get.mockResolvedValue(null);
  expect(await page()).toContain("Account created");
});

test("a server refusal opens the step it names, with its message", async () => {
  current.mockResolvedValue(guest);
  get.mockResolvedValue(null);
  const shown = steps(await page({ missing: "topic" })).filter(
    (step) => step.shown,
  );
  expect(shown).toHaveLength(1);
  expect(shown[0]?.html).toContain('name="topic"');
  expect(shown[0]?.html).toMatch(/role="alert"[^>]*>Pick at least one topic\./);
  expect(await page({ missing: "constructor" })).not.toContain('role="alert"');
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

// ADR-0015: goals first; every goal is live now (the book goal with W11, the stack goal
// with GitHub, P2-W12-S04).
test("onboarding asks for goals first, all of them live", async () => {
  current.mockResolvedValue(guest);
  get.mockResolvedValue(null);
  const html = await page();
  expect(html.indexOf('name="goal"')).toBeLessThan(
    html.indexOf('name="topic"'),
  );
  expect(html.match(/name="goal"/g)).toHaveLength(4);
  expect(html).not.toMatch(/<input[^>]*name="goal"[^>]*disabled=""/);
  expect(html).not.toContain("Coming soon");
});

// Q-P2-36 (owner): choosing the book goal leads to adding a book.
test("choosing the book goal goes on to Add a book, unless there is one already", async () => {
  const account: Actor = { ...guest, userId: "a1", isGuest: false };
  current.mockResolvedValue(account);
  const { onboardingAction } = await import("./actions");
  const answers = form({
    goal: ["finish-that-book", "stay-sharp"],
    topic: "backend",
    level: "beginner",
    breakLength: "3-8",
  });
  await expect(onboardingAction(answers)).rejects.toThrow(
    /^redirect:\/books\/new$/,
  );
  expect(list).toHaveBeenCalledWith("a1");
  // The first feed is still queued.
  expect(enqueue).toHaveBeenCalledWith(
    "recompute_feed",
    { user_id: "a1" },
    expect.anything(),
  );
  list.mockResolvedValueOnce([
    {
      bookId: "7",
      title: "Mine",
      status: "ready",
      failure: null,
      createdAt: new Date(),
    },
  ]);
  await expect(onboardingAction(answers)).rejects.toThrow(/^redirect:\/$/);
  // A guest too: Add a book says books need an account.
  current.mockResolvedValue(guest);
  await expect(onboardingAction(answers)).rejects.toThrow(
    /^redirect:\/books\/new$/,
  );
});

// P2-W12-S04 (ADR-0015): the stack goal leads to connecting GitHub; the book goal first.
test("choosing the stack goal without GitHub goes to connect it; connected or a guest, to the feed", async () => {
  const account: Actor = { ...guest, userId: "a2", isGuest: false };
  current.mockResolvedValue(account);
  const { onboardingAction } = await import("./actions");
  const answers = form({
    goal: "stack-i-use",
    topic: "backend",
    level: "beginner",
    breakLength: "3-8",
  });
  await expect(onboardingAction(answers)).rejects.toThrow(
    /^redirect:\/profile#github$/,
  );
  githubGet.mockResolvedValueOnce({
    login: "octo",
    connectedAt: new Date(),
    installations: [],
    syncedMinutesAgo: null,
    repositories: [],
  });
  await expect(onboardingAction(answers)).rejects.toThrow(/^redirect:\/$/);
  current.mockResolvedValue(guest);
  await expect(onboardingAction(answers)).rejects.toThrow(/^redirect:\/$/);
  // Both goals: Add a book first; Profile then offers GitHub.
  current.mockResolvedValue(account);
  const both = form({
    goal: ["finish-that-book", "stack-i-use"],
    topic: "backend",
    level: "beginner",
    breakLength: "3-8",
  });
  await expect(onboardingAction(both)).rejects.toThrow(
    /^redirect:\/books\/new$/,
  );
});
