import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import type {
  Actor,
  Entitlements,
  LoadedProblem,
  Matches,
} from "../../../../server/ports";

// P5-W31-S03 (§6.5): a battle's page, for its players, with the statement, the visible
// examples and each language's starter; never the extension (the game server's to show).
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const can = vi.fn<Entitlements["can"]>(() => Promise.resolve(true));
const serverFor = vi.fn<Matches["serverFor"]>();
const get = vi.fn<(slug: string) => Promise<LoadedProblem | null>>();
let gameConfigured = true;
vi.mock("../../../../server/container", () => ({
  sessionReader: () => ({ current }),
  entitlements: () => ({ can }),
  matches: () => ({ serverFor }),
  problems: () => ({ get }),
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
  notFound: () => {
    throw new Error("notFound");
  },
}));

const ada: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };
const id = "7d3c8f0e-5b7a-4a33-9a8e-1f2e3d4c5b6a";
const problem: LoadedProblem = {
  slug: "lru-cache",
  title: "LRU cache",
  difficulty: "easy",
  league: "human",
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

async function page(matchId = id): Promise<string> {
  const { default: BattlePage } = await import("./page");
  return renderToStaticMarkup(
    await BattlePage({ params: Promise.resolve({ id: matchId }) }),
  );
}

test("a player sees the statement, the examples and starters, never the extension", async () => {
  current.mockResolvedValue(ada);
  serverFor.mockResolvedValue({
    serverId: 0,
    playedAs: "u1",
    problem: "lru-cache",
  });
  get.mockResolvedValue(problem);
  const html = await page();
  expect(serverFor).toHaveBeenCalledWith(id, "u1");
  expect(get).toHaveBeenCalledWith("lru-cache");
  expect(html).toContain("LRU cache");
  expect(html).toContain("Keep the most recent.");
  // Monaco fills this on the client, starting with the first language's starter.
  expect(html).toContain("Code editor (python)");
  expect(html).not.toContain("SECRET EXTENSION");
  expect(can.mock.calls.map(([, c]) => c).sort()).toEqual([
    "play.battle",
    "play.live",
  ]);
});

test("signed out, without the capabilities, or unconfigured: back to Play", async () => {
  current.mockResolvedValue(null);
  await expect(page()).rejects.toThrow("redirect:/play");
  current.mockResolvedValue(ada);
  can.mockImplementation((_, c) => Promise.resolve(c !== "play.battle"));
  await expect(page()).rejects.toThrow("redirect:/play");
  can.mockImplementation(() => Promise.resolve(true));
  gameConfigured = false;
  await expect(page()).rejects.toThrow("redirect:/play");
});

test("not a player, not a battle, not an id, or no such problem: not found", async () => {
  current.mockResolvedValue(ada);
  serverFor.mockResolvedValue(null);
  await expect(page()).rejects.toThrow("notFound");
  serverFor.mockResolvedValue({ serverId: 0, playedAs: "u1", problem: null });
  await expect(page()).rejects.toThrow("notFound");
  await expect(page("../evil")).rejects.toThrow("notFound");
  serverFor.mockResolvedValue({ serverId: 0, playedAs: "u1", problem: "gone" });
  get.mockResolvedValue(null);
  await expect(page()).rejects.toThrow("notFound");
});
