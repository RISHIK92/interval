import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import type {
  Actor,
  Feedback,
  Preferences,
  Progress,
  GitHubAccounts,
} from "../../server/ports";

// §5A, Q-P1-36, P1-W4-S08: choices, hidden sources, and what was inferred.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const get = vi.fn<(userId: string) => Promise<Preferences | null>>();
const hiddenSources = vi.fn<Feedback["hiddenSources"]>(() =>
  Promise.resolve([{ sourceId: "7", name: "Example Engineering" }]),
);
const inferred = vi.fn<Feedback["inferred"]>(() =>
  Promise.resolve({
    more: [{ itemId: "1", title: "Raft in practice" }],
    less: [{ itemId: "2", title: "Yet another ORM" }],
    avoidedConcepts: [{ slug: "wal", name: "Write-ahead log" }],
  }),
);
const explored = vi.fn<Progress["concepts"]>(() => Promise.resolve([]));
let githubOffered = true;
const githubConnection = vi.fn<GitHubAccounts["get"]>(() =>
  Promise.resolve(null),
);
vi.mock("../../server/container", () => ({
  sessionReader: () => ({ current }),
  preferences: () => ({ get }),
  feedback: () => ({ hiddenSources, inferred }),
  progress: () => ({ concepts: explored }),
  githubApp: () => (githubOffered ? {} : null),
  githubAccounts: () => ({ get: githubConnection }),
}));
const themeCookie = vi.fn<(name: string) => { value: string } | undefined>();
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
  cookies: () => Promise.resolve({ get: themeCookie }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const guest: Actor = { userId: "g1", isGuest: true, betaGroup: "student" };
const user: Actor = { ...guest, userId: "u1", isGuest: false };
const preferences = {
  goals: ["stay-sharp" as const],
  topics: ["databases" as const],
  level: "beginner" as const,
  breakLength: "3-8" as const,
  firstName: null,
};

afterEach(() => {
  vi.clearAllMocks();
  githubOffered = true;
});

async function page(query: Record<string, string> = {}): Promise<string> {
  const { default: ProfilePage } = await import("./page");
  return renderToStaticMarkup(
    await ProfilePage({ searchParams: Promise.resolve(query) }),
  );
}

test("the choices form is filled in with the user's choices", async () => {
  current.mockResolvedValue(guest);
  get.mockResolvedValue({
    goals: ["system-design-interviews"],
    topics: ["databases"],
    level: "advanced",
    breakLength: "8-15",
  });
  const html = await page();
  const checked = (value: string) =>
    (html.match(/<input[^>]*>/g) ?? []).some(
      (tag) => tag.includes(`value="${value}"`) && tag.includes("checked"),
    );
  expect(checked("system-design-interviews")).toBe(true); // ADR-0015
  expect(checked("stay-sharp")).toBe(false);
  expect(checked("databases")).toBe(true);
  expect(checked("backend")).toBe(false);
  expect(checked("advanced")).toBe(true);
  expect(checked("8-15")).toBe(true);
});

test("hidden sources and inferred interests are listed with their actions", async () => {
  current.mockResolvedValue(guest);
  get.mockResolvedValue({
    goals: ["system-design-interviews"],
    topics: ["databases"],
    level: "advanced",
    breakLength: "8-15",
  });
  const html = await page({ saved: "reset" });
  expect(html).toContain("Example Engineering");
  expect(html).toContain('name="sourceId" value="7"');
  expect(html).toContain("Raft in practice");
  expect(html).toContain("Yet another ORM");
  expect(html).toContain("Write-ahead log");
  expect(html).toContain("Reset inferred interests");
  expect(html).toContain("Inferred interests reset.");
});

// ADR-0015: the goals read as they were picked; the way back is the feed.
test("the user's goals are listed by their labels, with a way back to the feed", async () => {
  current.mockResolvedValue(guest);
  get.mockResolvedValue({
    goals: ["system-design-interviews", "stay-sharp"],
    topics: ["databases"],
    level: "advanced",
    breakLength: "8-15",
  });
  const html = await page();
  const goals = /<section aria-label="Your goals">(.*?)<\/section>/.exec(
    html,
  )?.[1];
  expect(goals).toContain("Pass system design interviews");
  expect(goals).toContain("Stay sharp, nothing formal");
  expect(goals).not.toContain("Finally finish that book");
  expect(html).toMatch(
    /<a[^>]*href="\/"[^>]*aria-label="Back to your feed"|<a[^>]*aria-label="Back to your feed"[^>]*href="\/"/,
  );
});

test("no session goes to /join; not onboarded goes to /onboarding", async () => {
  current.mockResolvedValue(null);
  await expect(page()).rejects.toThrow("redirect:/join");
  current.mockResolvedValue(guest);
  get.mockResolvedValue(null);
  await expect(page()).rejects.toThrow("redirect:/onboarding");
});

// The query string picks a fixed message; it is never shown itself.
test("notices come from fixed text, never from the query string", async () => {
  current.mockResolvedValue(guest);
  get.mockResolvedValue({
    goals: ["system-design-interviews"],
    topics: ["databases"],
    level: "advanced",
    breakLength: "8-15",
  });
  const odd = await page({ saved: "<b>x</b>", missing: "constructor" });
  expect(odd).not.toContain('role="status"');
  expect(odd).not.toContain('role="alert"');
  expect(odd).not.toContain("&lt;b&gt;x");
  expect(await page({ missing: "topic" })).toMatch(
    /<p role="alert"[^>]*>Pick at least one topic\.<\/p>/,
  );
});

// The device's theme (owner, 2026-10-26): three choices, the current one pressed.
test("appearance offers light, dark and the device's own, this device's marked", async () => {
  current.mockResolvedValue(guest);
  get.mockResolvedValue({
    goals: ["system-design-interviews"],
    topics: ["databases"],
    level: "advanced",
    breakLength: "8-15",
  });
  themeCookie.mockReturnValue({ value: "dark" });
  const html = await page();
  for (const theme of ["light", "dark", "system"]) {
    expect(html).toMatch(
      new RegExp(
        `name="theme"[^>]*value="${theme}"|value="${theme}"[^>]*name="theme"`,
      ),
    );
  }
  expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
  expect(html).toMatch(
    /aria-pressed="true"[^>]*value="dark"|value="dark"[^>]*aria-pressed="true"/,
  );
  expect(html).toMatch(/<input[^>]*name="back"[^>]*value="\/profile"/);
});

// Q-P2-04, P2-W7-S02: what reading has explored, by topic (§3.1 learner state).
test("Profile lists the user's concepts by topic with their states, or says how to start", async () => {
  current.mockResolvedValue(guest);
  get.mockResolvedValue({
    goals: [],
    topics: ["databases"],
    level: "beginner",
    breakLength: "3-8",
  });
  const empty = await page();
  expect(empty).toContain("Your concepts");
  expect(empty).toContain("Finish a section or an article, or take Test 60s");
  explored.mockResolvedValueOnce([
    {
      topic: "distributed-systems",
      concepts: [
        { slug: "raft", name: "Raft", state: "mastered", due: true },
        { slug: "paxos", name: "Paxos", state: "explored", due: false },
      ],
    },
    {
      topic: "databases",
      concepts: [
        { slug: "mvcc", name: "MVCC", state: "practiced", due: false },
      ],
    },
  ]);
  const html = await page();
  // The choices form names every topic too: look only at this section.
  const section = html.slice(html.indexOf("Your concepts"));
  expect(section.indexOf("Raft")).toBeLessThan(section.indexOf("Paxos"));
  expect(section.indexOf("Distributed systems")).toBeGreaterThan(-1);
  expect(section.indexOf("Distributed systems")).toBeLessThan(
    section.indexOf("Databases"),
  );
  expect(section).toContain("MVCC");
  // P2-W9-S03: each concept's state in words (§3.1), not colour alone.
  expect(section).toMatch(/Raft[^]*?Mastered[^]*?Paxos[^]*?Explored/);
  expect(section).toMatch(/MVCC[^]*?Practiced/);
  // P2-W9-S04: a due card says so beside the state, which it doesn't replace.
  expect(section).toMatch(/Raft[^]*?Mastered · Due for review[^]*?Paxos/);
  expect(section).not.toMatch(/Paxos[^]*?Explored · Due/);
  expect(explored).toHaveBeenCalledWith("g1");
});

// P2-W12-S01 (§5H, ADR-0024): connecting GitHub, accounts only.
describe("GitHub", () => {
  test("an account not connected can connect, or link an App installed before", async () => {
    current.mockResolvedValue(user);
    get.mockResolvedValue(preferences);
    const html = await page();
    expect(html).toContain('href="/api/github/connect"');
    expect(html).toContain('href="/api/github/connect?link=1"');
    expect(html).toContain(
      "Interval reads your repositories&#x27; names and dependency files",
    );
  });

  test("connected: who, where, and Disconnect with how to revoke on GitHub", async () => {
    current.mockResolvedValue(user);
    get.mockResolvedValue(preferences);
    githubConnection.mockResolvedValueOnce({
      login: "octo",
      connectedAt: new Date(),
      installations: [
        { installationId: "11", accountLogin: "octo", accountType: "User" },
        {
          installationId: "12",
          accountLogin: "acme",
          accountType: "Organization",
        },
      ],
      syncedMinutesAgo: null,
      repositories: [],
    });
    const html = await page();
    expect(html).toContain("Connected as @octo");
    expect(html).toContain("On your account");
    expect(html).toContain("On acme");
    expect(html).toMatch(/popover[tT]arget="disconnect-github"/);
    expect(html).toContain("Disconnect GitHub");
    expect(html).toContain(
      'href="https://github.com/settings/installations/11"',
    );
    expect(html).toContain(
      'href="https://github.com/organizations/acme/settings/installations/12"',
    );
    expect(html).toContain('href="https://github.com/settings/installations"');
  });

  test("a guest is asked to create an account; not configured says so", async () => {
    current.mockResolvedValue(guest);
    get.mockResolvedValue(preferences);
    let html = await page();
    expect(html).toContain("Create an account to connect GitHub");
    expect(html).not.toContain("/api/github/connect");
    expect(githubConnection).not.toHaveBeenCalled();
    current.mockResolvedValue(user);
    githubOffered = false;
    html = await page();
    expect(html).toContain("Connecting GitHub isn&#x27;t available yet.");
  });

  test("the callback's outcomes are told in fixed words", async () => {
    current.mockResolvedValue(user);
    get.mockResolvedValue(preferences);
    expect(await page({ saved: "github" })).toContain("GitHub connected.");
    expect(await page({ github: "failed" })).toContain(
      "GitHub couldn&#x27;t be connected. Try again.",
    );
    expect(await page({ github: "none" })).toContain(
      "Install Interval on at least one repository",
    );
    expect(await page({ github: "<b>x</b>" })).not.toContain("<b>x</b>");
  });
});

// P2-W12-S02: what the worker read, and Refresh.
test("connected and read: the repositories with their languages and dependencies, and Refresh", async () => {
  current.mockResolvedValue(user);
  get.mockResolvedValue(preferences);
  githubConnection.mockResolvedValueOnce({
    login: "octo",
    connectedAt: new Date(),
    installations: [
      { installationId: "11", accountLogin: "octo", accountType: "User" },
    ],
    syncedMinutesAgo: 5,
    repositories: [
      {
        fullName: "octo/api",
        languages: ["TypeScript", "Go"],
        dependencies: 12,
      },
    ],
  });
  const html = await page();
  expect(html).toContain("octo/api");
  expect(html).toContain("TypeScript, Go · 12 dependencies");
  expect(html).toMatch(/Read \d+ min ago/);
  expect(html).toMatch(/<form[^>]*>[^]*?Refresh<\/button>/);
  // Before the first read.
  githubConnection.mockResolvedValueOnce({
    login: "octo",
    connectedAt: new Date(),
    installations: [
      { installationId: "11", accountLogin: "octo", accountType: "User" },
    ],
    syncedMinutesAgo: null,
    repositories: [],
  });
  expect(await page()).toContain("Reading your repositories…");
});
