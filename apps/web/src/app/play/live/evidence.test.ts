import { afterEach, expect, test, vi } from "vitest";
import type { Actor, Quizzes } from "../../../server/ports";
import { applyMatchEvidence } from "./evidence";

// P3-W15-S05: applied on a visit, one event per match; a failure doesn't break the page.
const apply = vi.fn<Quizzes["applyMatchEvidence"]>(() => Promise.resolve([]));
const emit = vi.fn();
const invalidate = vi.fn(() => Promise.resolve());
vi.mock("../../../server/container", () => ({
  quizzes: () => ({ applyMatchEvidence: apply }),
  events: () => ({ emit }),
  leaderboards: () => ({ invalidate }),
}));
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === "iv_visit" ? { name, value: "visit-1.1790000000" } : undefined,
    }),
}));

const actor: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };

afterEach(() => {
  vi.clearAllMocks();
});

test("each applied match is one event", async () => {
  apply.mockResolvedValueOnce([
    {
      outcome: "finished",
      won: true,
      abandoned: false,
      missed: [{ itemId: "4", momentId: "40" }],
    },
    { outcome: "abandoned", won: false, abandoned: true, missed: [] },
  ]);
  await applyMatchEvidence(actor);
  expect(apply).toHaveBeenCalledWith("u1");
  expect(emit.mock.calls).toEqual([
    [
      "match_finished",
      { outcome: "finished", won: true, abandoned: false },
      expect.objectContaining({ userId: "u1", sessionId: "visit-1" }),
    ],
    // P3-W18-S03: its miss, back to reading.
    [
      "concept_missed",
      { game: "live", item_id: "4", moment_id: "40" },
      expect.objectContaining({ userId: "u1" }),
    ],
    [
      "match_finished",
      { outcome: "abandoned", won: false, abandoned: true },
      expect.objectContaining({ userId: "u1" }),
    ],
  ]);
  // P3-W16-S06: the new rating reaches the player's season boards now.
  expect(invalidate).toHaveBeenCalledExactlyOnceWith("u1");
});

test("nothing pending: no event; a failure is logged, never thrown", async () => {
  await applyMatchEvidence(actor);
  expect(emit).not.toHaveBeenCalled();
  expect(invalidate).not.toHaveBeenCalled();
  const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  apply.mockRejectedValueOnce(new Error("db down"));
  await expect(applyMatchEvidence(actor)).resolves.toBeUndefined();
  expect(out.mock.calls.map(([c]) => String(c)).join("")).toContain(
    "game: match evidence not applied",
  );
  out.mockRestore();
});
