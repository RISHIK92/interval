import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type {
  Actor,
  Entitlements,
  PracticeBest,
  PracticeProblem,
} from "../../../../server/ports";

// ADR-0048 (Q-WD-28): the practice list, grouped by topic, with each problem's
// difficulty and the player's best.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const can = vi.fn<Entitlements["can"]>(() => Promise.resolve(true));
const practice = vi.fn<() => Promise<PracticeProblem[]>>();
const best = vi.fn<(userId: string) => Promise<Map<string, PracticeBest>>>();
let gameConfigured = true;
vi.mock("../../../../server/container", () => ({
  sessionReader: () => ({ current }),
  entitlements: () => ({ can }),
  preferences: () => ({ get: () => Promise.resolve(null) }),
  problems: () => ({ practice }),
  lldPractice: () => ({ best }),
}));
vi.mock("../../../../env", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  gameEnv: () => (gameConfigured ? { GAME_TICKET_SECRET: "s" } : null),
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
  useRouter: () => ({ push: () => undefined }),
}));

const ada: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };
const problems: PracticeProblem[] = [
  {
    slug: "lru-cache",
    title: "LRU cache",
    difficulty: "easy",
    topic: "systems",
    concepts: ["Caching"],
  },
  {
    slug: "parking-lot",
    title: "Parking lot",
    difficulty: "medium",
    topic: "systems",
    concepts: [],
  },
  {
    slug: "shapes",
    title: "Shapes",
    difficulty: "easy",
    topic: "oop-basics",
    concepts: [],
  },
];
const layers = {
  visible: { passed: 1, total: 1 },
  hidden: { passed: 9, total: 10 },
  concurrency: { passed: 0, total: 2 },
  extension: { passed: 0, total: 0 },
};

afterEach(() => {
  vi.clearAllMocks();
  gameConfigured = true;
});

async function page(): Promise<string> {
  const { default: PracticeList } = await import("./page");
  return renderToStaticMarkup(await PracticeList());
}

test("problems in topic groups, each with its difficulty and the player's best", async () => {
  current.mockResolvedValue(ada);
  practice.mockResolvedValue(problems);
  best.mockResolvedValue(
    new Map([
      [
        "lru-cache",
        {
          slug: "lru-cache",
          points: 820,
          layers,
          language: "python",
          achievedAt: new Date(),
          submits: 3,
        },
      ],
    ]),
  );
  const html = await page();
  expect(best).toHaveBeenCalledWith("u1");
  expect(html).toContain("LLD practice");
  // Groups in the topics' order, each with its count.
  expect(html.indexOf("OOP basics")).toBeLessThan(html.indexOf("Systems"));
  expect(html).toMatch(/Systems[^]*?2 problems/);
  expect(html).toMatch(/OOP basics[^]*?1 problem\b/);
  expect(html).toContain('href="/play/battle/practice/lru-cache"');
  expect(html).toContain("Caching");
  expect(html).toContain("Best 820 · hidden 9/10");
  expect(html).toContain("Not started");
  expect(html).toMatch(/>easy</);
  expect(html).toMatch(/>medium</);
  // A random problem, and a way to list them all without groups; back to the lobby.
  expect(html).toMatch(
    /href="\/play\/battle\/practice\/(lru-cache|parking-lot|shapes)"[^>]*>Random problem</,
  );
  expect(html).toContain("Hide groups");
  expect(html).toContain('href="/play/battle"');
});

test("signed out, without battles, or unconfigured: back to Play", async () => {
  current.mockResolvedValue(null);
  await expect(page()).rejects.toThrow("redirect:/play");
  current.mockResolvedValue(ada);
  can.mockResolvedValueOnce(false);
  await expect(page()).rejects.toThrow("redirect:/play");
  gameConfigured = false;
  await expect(page()).rejects.toThrow("redirect:/play");
});
