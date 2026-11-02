import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import type {
  Actor,
  Feedback,
  Preferences,
  Progress,
  GitHubAccounts,
  PlayerCountries,
  PlayerUniversities,
  University,
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
  playerCountries: () => ({ get: countryGet }),
  playerUniversities: () => ({ get: universityGet, search: universitySearch }),
}));
const universityGet = vi.fn<PlayerUniversities["get"]>(() =>
  Promise.resolve({ university: null, changeableFrom: null }),
);
const universitySearch = vi.fn<PlayerUniversities["search"]>(() =>
  Promise.resolve([]),
);
const countryGet = vi.fn<PlayerCountries["get"]>(() =>
  Promise.resolve({ country: null, changeableFrom: null }),
);
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
  current.mockResolvedValue(user);
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
  current.mockResolvedValue(user);
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
  current.mockResolvedValue(user);
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

test("no session goes to /join, a guest to /sign-up, not onboarded to /onboarding", async () => {
  current.mockResolvedValue(null);
  await expect(page()).rejects.toThrow("redirect:/join");
  current.mockResolvedValue(user);
  get.mockResolvedValue(null);
  await expect(page()).rejects.toThrow("redirect:/onboarding");
  // ADR-0029: guests play, and only play.
  current.mockResolvedValue(guest);
  await expect(page()).rejects.toThrow("redirect:/sign-up");
});

// The query string picks a fixed message; it is never shown itself.
test("notices come from fixed text, never from the query string", async () => {
  current.mockResolvedValue(user);
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
  current.mockResolvedValue(user);
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
  current.mockResolvedValue(user);
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
  expect(explored).toHaveBeenCalledWith("u1");
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

  test("not configured says so", async () => {
    current.mockResolvedValue(user);
    get.mockResolvedValue(preferences);
    githubOffered = false;
    const html = await page();
    expect(html).toContain("Connecting GitHub isn&#x27;t available yet.");
    expect(html).not.toContain("/api/github/connect");
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
        technologies: ["PostgreSQL", "Redis"],
      },
    ],
  });
  const html = await page();
  expect(html).toContain("octo/api");
  expect(html).toContain("TypeScript, Go · 12 dependencies");
  // P2-W12-S04: what the repository's dependencies map to.
  expect(html).toContain("Uses PostgreSQL, Redis");
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

// P3-W14-S02 (§6.7, Q-P3-08; owner, 2026-11-02).
describe("country", () => {
  const signedIn = () => {
    current.mockResolvedValue(user);
    get.mockResolvedValue(preferences);
  };
  const tag = (html: string, pattern: RegExp) =>
    (html.match(/<(select|option|button)[^>]*>/g) ?? []).find((t) =>
      pattern.test(t),
    ) ?? "";

  test("not set: every country by name, none chosen, and no Remove", async () => {
    signedIn();
    const html = await page();
    expect(html).toContain("Country");
    expect(html).toMatch(/<option value="IN"[^>]*>India<\/option>/);
    expect(html).toMatch(/<option value="DE"[^>]*>Germany<\/option>/);
    expect(html).not.toMatch(/<option value="EU"/);
    expect(tag(html, /value="IN"/)).not.toContain("selected");
    expect(tag(html, /<select/)).not.toContain("disabled");
    // "Not set" can't be saved.
    expect(tag(html, /<select/)).toContain("required");
    expect(html).not.toContain("Remove country");
  });

  test("set and changeable: chosen in the list, with Remove", async () => {
    signedIn();
    countryGet.mockResolvedValueOnce({ country: "IN", changeableFrom: null });
    const html = await page({ saved: "country" });
    expect(tag(html, /value="IN"/)).toContain("selected");
    expect(html).toContain("Remove country");
    expect(html).toContain("Country saved. Country boards update in a moment.");
  });

  test("inside the month: the list is locked until a given day, Remove still there", async () => {
    signedIn();
    countryGet.mockResolvedValueOnce({
      country: "IN",
      changeableFrom: new Date("2026-12-02T10:00:00Z"),
    });
    const html = await page({ country: "soon" });
    expect(tag(html, /<select/)).toContain("disabled");
    // It opens at 10:00 UTC on the 2nd, so the first whole day is the 3rd.
    expect(html).toContain("You can change it again from 3 December 2026.");
    expect(html).toContain("Remove country");
    expect(html).toContain("A country can be changed once a month.");
  });

  test("removed inside the month: Not set, locked, and no Remove", async () => {
    signedIn();
    countryGet.mockResolvedValueOnce({
      country: null,
      changeableFrom: new Date("2026-12-02T10:00:00Z"),
    });
    const html = await page();
    expect(tag(html, /<select/)).toContain("disabled");
    expect(html).toContain("You can change it again from 3 December 2026.");
    expect(html).not.toContain("Remove country");
  });
});

// P3-W14-S03 (§6.7, ADR-0032): picked from the list or typed; once a month.
describe("university", () => {
  const signedIn = () => {
    current.mockResolvedValue(user);
    get.mockResolvedValue(preferences);
  };
  const DELHI: University = {
    id: "7",
    name: "Indian Institute of Technology Delhi",
    country: "IN",
    listed: true,
  };
  const TYPED: University = {
    id: "9",
    name: "Night School",
    country: null,
    listed: false,
  };

  test("not set: a search and a typed name, no results until searched, no Remove", async () => {
    signedIn();
    const html = await page();
    expect(html).toContain('aria-label="University"');
    expect(html).toMatch(/<form[^>]*action="\/profile"[^>]*method="get"/);
    expect(html).toMatch(/<input[^>]*name="uq"/);
    expect(html).toMatch(/<input[^>]*required[^>]*name="name"/);
    expect(html).toContain("Use this name");
    expect(universitySearch).not.toHaveBeenCalled();
    expect(html).not.toContain("Remove university");
  });

  test("searching lists matches, each with its country and a Choose button", async () => {
    signedIn();
    universitySearch.mockResolvedValueOnce([DELHI, TYPED]);
    const html = await page({ uq: " delhi " });
    expect(universitySearch).toHaveBeenCalledExactlyOnceWith("delhi", 20);
    expect(html).toMatch(/<input[^>]*name="uq"[^>]*value=" delhi "/);
    expect(html).toContain("Indian Institute of Technology Delhi");
    expect(html).toContain("India");
    expect(html).toContain(
      'aria-label="Choose Indian Institute of Technology Delhi"',
    );
    expect(html).toMatch(/<input[^>]*name="universityId"[^>]*value="7"/);
    expect(html).toContain("Added by players");
  });

  test("a search with no match says so; one letter isn't searched", async () => {
    signedIn();
    const none = await page({ uq: "zzzz" });
    expect(none).toContain("No university matches");
    await page({ uq: "z" });
    expect(universitySearch).toHaveBeenCalledOnce();
  });

  test("set: shown with its country, with Remove", async () => {
    signedIn();
    universityGet.mockResolvedValueOnce({
      university: DELHI,
      changeableFrom: null,
    });
    const html = await page({ saved: "university" });
    expect(html).toContain("Indian Institute of Technology Delhi");
    expect(html).toContain("Remove university");
    expect(html).toContain("University saved.");
  });

  test("inside the month: no search or typing, the day it opens, Remove still there", async () => {
    signedIn();
    universityGet.mockResolvedValueOnce({
      university: TYPED,
      changeableFrom: new Date("2026-12-02T10:00:00Z"),
    });
    const html = await page({ university: "soon", uq: "delhi" });
    expect(html).not.toMatch(/name="uq"/);
    expect(html).not.toContain("Use this name");
    expect(universitySearch).not.toHaveBeenCalled();
    expect(html).toContain("Night School");
    expect(html).toContain("You can change it again from 3 December 2026.");
    expect(html).toContain("Remove university");
    expect(html).toContain("A university can be changed once a month.");
  });

  test("a typed name of the wrong length is explained", async () => {
    signedIn();
    const html = await page({ university: "name" });
    expect(html).toContain(
      "A university&#x27;s name is 2 to 120 letters, without hidden characters.",
    );
  });
});
