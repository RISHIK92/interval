import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type {
  Actor,
  Entitlements,
  LoadedProblem,
  PracticeBest,
  PracticeCode,
} from "../../../../../server/ports";

// ADR-0048 (Q-WD-28): a practice problem on the battle screen: its statement, examples,
// starters or the player's saved code, and their best; never the extension, which the
// game server sends when the player reveals it. A battle problem isn't practice.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const can = vi.fn<Entitlements["can"]>(() => Promise.resolve(true));
const get = vi.fn<(slug: string) => Promise<LoadedProblem | null>>();
const loadCode =
  vi.fn<(userId: string, slug: string) => Promise<Map<string, PracticeCode>>>();
const bestFor =
  vi.fn<(userId: string, slug: string) => Promise<PracticeBest | null>>();
let gameConfigured = true;
vi.mock("../../../../../server/container", () => ({
  sessionReader: () => ({ current }),
  entitlements: () => ({ can }),
  problems: () => ({ get }),
  lldPractice: () => ({ loadCode, bestFor }),
}));
vi.mock("../../../../../env", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  gameEnv: () => (gameConfigured ? { GAME_TICKET_SECRET: "s" } : null),
}));
vi.mock("./actions", () => ({
  saveCode: vi.fn(),
  startSession: vi.fn(),
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));

const ada: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };
const problem: LoadedProblem = {
  slug: "lru-cache",
  title: "LRU cache",
  difficulty: "easy",
  battleMode: "human",
  pool: "practice",
  topic: "systems",
  concepts: [],
  interviewerNotes: null,
  statement: "# LRU cache\n\nKeep the most recent.",
  interface: {
    class: "LRUCache",
    constructor: { params: [{ name: "capacity", type: "int" }] },
    methods: [{ name: "size", params: [], returns: "int" }],
  },
  checks: [],
  limits: { seconds: 5, memoryMB: 128 },
  visible: [
    { scenario: { calls: [{ method: "new", args: [2] }] }, results: [] },
  ],
  extension: {
    statement: "# SECRET EXTENSION",
    interface: { class: "LRUCache", constructor: { params: [] }, methods: [] },
  },
  privateKey: "k",
  contentHash: "h",
};

afterEach(() => {
  vi.clearAllMocks();
  gameConfigured = true;
});

async function page(slug = "lru-cache"): Promise<string> {
  const { default: PracticePage } = await import("./page");
  return renderToStaticMarkup(
    await PracticePage({ params: Promise.resolve({ slug }) }),
  );
}

test("the problem on the battle screen, with the player's best and no extension", async () => {
  current.mockResolvedValue(ada);
  get.mockResolvedValue(problem);
  loadCode.mockResolvedValue(new Map());
  bestFor.mockResolvedValue({
    slug: "lru-cache",
    points: 820,
    layers: {
      visible: { passed: 1, total: 1 },
      hidden: { passed: 9, total: 10 },
      concurrency: { passed: 0, total: 2 },
      extension: { passed: 0, total: 0 },
    },
    language: "python",
    achievedAt: new Date(),
    submits: 4,
  });
  const html = await page();
  expect(get).toHaveBeenCalledWith("lru-cache");
  expect(loadCode).toHaveBeenCalledWith("u1", "lru-cache");
  expect(html).toContain("LRU cache");
  expect(html).toContain("Keep the most recent.");
  expect(html).toContain("LRUCache(2)");
  expect(html).toContain("Your best: 820 · hidden 9/10");
  expect(html).toContain("Code editor (python)");
  expect(html).not.toContain("SECRET EXTENSION");
  expect(html).not.toContain('role="timer"');
  expect(html).toContain('href="/play/battle/practice"');
});

test("a battle problem, or none, is not found", async () => {
  current.mockResolvedValue(ada);
  get.mockResolvedValue({ ...problem, pool: "battle", topic: null });
  await expect(page()).rejects.toThrow("notFound");
  get.mockResolvedValue(null);
  await expect(page("nope")).rejects.toThrow("notFound");
  expect(loadCode).not.toHaveBeenCalled();
});

test("signed out, without the capabilities, or unconfigured: back to Play", async () => {
  current.mockResolvedValue(null);
  await expect(page()).rejects.toThrow("redirect:/play");
  current.mockResolvedValue(ada);
  can.mockImplementation((_, c) => Promise.resolve(c !== "play.live"));
  await expect(page()).rejects.toThrow("redirect:/play");
  can.mockImplementation(() => Promise.resolve(true));
  gameConfigured = false;
  await expect(page()).rejects.toThrow("redirect:/play");
});
