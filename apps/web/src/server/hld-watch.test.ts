import { describe, expect, test } from "vitest";
import { accessTo, thin } from "./hld-watch";
import type { HldMatches, HldTournaments } from "./ports";

// P6-W44 (§6.4, Q-P6-08): who may watch a match live, or replay it.
function deps(o: {
  players: string[];
  closed: boolean;
  round: { players: string[]; over: boolean } | null;
}) {
  return {
    matches: {
      get: () =>
        Promise.resolve({
          match: { closedAt: o.closed ? new Date() : null },
          seats: o.players.map((userId) => ({ userId })),
        }),
    } as unknown as HldMatches, // only get is used
    tournaments: {
      roundOf: () => Promise.resolve(o.round),
    } as unknown as HldTournaments, // only roundOf is used
  };
}

describe("access to a match", () => {
  test("its players replay it once it's over, never watch it live", async () => {
    const d = deps({ players: ["a", "b"], closed: false, round: null });
    expect(await accessTo(d, "m", "a")).toBeNull();
    const over = deps({ players: ["a", "b"], closed: true, round: null });
    expect(await accessTo(over, "m", "a")).toBe("replay");
  });

  test("a casual match stays with its players", async () => {
    const d = deps({ players: ["a", "b"], closed: true, round: null });
    expect(await accessTo(d, "m", "eve")).toBeNull();
  });

  test("a tournament match: live for outsiders, hidden from the round, public once over", async () => {
    const live = { players: ["a", "b", "c", "d"], over: false };
    const d = deps({ players: ["a", "b"], closed: false, round: live });
    expect(await accessTo(d, "m", "eve")).toBe("live");
    expect(await accessTo(d, "m", "c")).toBeNull(); // in the same round
    const over = deps({
      players: ["a", "b"],
      closed: true,
      round: { ...live, over: true },
    });
    expect(await accessTo(over, "m", "c")).toBe("replay");
  });
});

test("a long replay is thinned evenly, keeping the first and the last", () => {
  const frames = Array.from({ length: 1000 }, (_, i) => i);
  const kept = thin(frames, 200);
  expect(kept).toHaveLength(200);
  expect(kept[0]).toBe(0);
  expect(kept.at(-1)).toBe(999);
  expect(thin([1, 2, 3], 200)).toEqual([1, 2, 3]);
});
