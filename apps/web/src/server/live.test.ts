import { afterEach, expect, test, vi } from "vitest";
import { memoryMatches } from "./adapters/kysely-matches";
import type { LiveMatch, LiveRound, MatchHandoff } from "./ports";
import { startGhostMatch, startLiveMatch } from "./live";

// P3-W15-S03 (Q-P3-22): a match is made with its questions, then handed to its server.
const bank: LiveRound[] = Array.from({ length: 30 }, (_, i) => ({
  question: String(i + 1),
  stem: "Which?",
  options: ["a", "b", "c", "d"],
  correct: 0,
}));

afterEach(() => {
  vi.restoreAllMocks();
});

test("makes the match on server 0 and hands it over", async () => {
  const put = vi.fn<MatchHandoff["put"]>(() => Promise.resolve());
  const match = await startLiveMatch(
    memoryMatches(new Map(), bank),
    { put },
    ["ada", "bob"],
    "sprint",
  );
  expect(match.serverId).toBe(0);
  expect(match.mode).toBe("sprint");
  expect(put).toHaveBeenCalledExactlyOnceWith(match);
});

test("too few live questions: no match", async () => {
  const put = vi.fn<MatchHandoff["put"]>(() => Promise.resolve());
  await expect(
    startLiveMatch(
      memoryMatches(new Map(), bank.slice(1)),
      { put },
      ["ada", "bob"],
      "sprint",
    ),
  ).rejects.toThrow("not enough live questions");
  expect(put).not.toHaveBeenCalled();
});

test("a failed handoff is logged and thrown: the match can't start without its set", async () => {
  const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const put = vi.fn<(m: LiveMatch) => Promise<void>>(() =>
    Promise.reject(new Error("valkey down")),
  );
  await expect(
    startLiveMatch(
      memoryMatches(new Map(), bank),
      { put },
      ["ada", "bob"],
      "sprint",
    ),
  ).rejects.toThrow("valkey down");
  expect(out.mock.calls.map(([c]) => String(c)).join("")).toContain(
    "game: match not handed over",
  );
});

test.each([[["ada"]], [["ada", "ada"]], [["ada", "bob", "cat"]], [[]]])(
  "a 1v1 match needs two different players (%j)",
  async (players) => {
    const put = vi.fn<MatchHandoff["put"]>(() => Promise.resolve());
    await expect(
      startLiveMatch(
        memoryMatches(new Map(), bank),
        { put },
        players,
        "sprint",
      ),
    ).rejects.toThrow("two different players");
    expect(put).not.toHaveBeenCalled();
  },
);

// P3-W17-S01: a ghost match is handed over like any; none when no run fits.
test("a ghost match is handed over, or there is none", async () => {
  const put = vi.fn<MatchHandoff["put"]>(() => Promise.resolve());
  const ghost: LiveMatch = {
    id: "m1",
    serverId: 0,
    players: ["ada", "ghost:1"],
    mode: "sprint",
    rounds: bank,
    ghost: { player: "ghost:1", label: "Ghost · ~1500", answers: [] },
  };
  const matches = {
    ...memoryMatches(new Map(), bank),
    createGhost: vi.fn(() => Promise.resolve(ghost)),
  };
  expect(await startGhostMatch(matches, { put }, "ada", "sprint")).toBe(ghost);
  expect(put).toHaveBeenCalledExactlyOnceWith(ghost);
  put.mockClear();
  expect(
    await startGhostMatch(
      memoryMatches(new Map(), bank),
      { put },
      "ada",
      "sprint",
    ),
  ).toBeNull();
  expect(put).not.toHaveBeenCalled();
});
