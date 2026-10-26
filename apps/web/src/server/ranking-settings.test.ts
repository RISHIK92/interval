import { expect, test, vi } from "vitest";
import type { JobQueue, RankingInspection } from "./ports";
import { saveRankingSetting } from "./ranking-settings";

// P1-W6-S01: the owner tunes ranking_config from the inspection page. Each key keeps
// the range the worker accepts, so a saved value can never stop ranking.
function fakes(result: "changed" | "unchanged" | "missing" = "changed") {
  const setSetting = vi.fn<RankingInspection["setSetting"]>(() =>
    Promise.resolve(result),
  );
  const enqueue = vi.fn<JobQueue["enqueue"]>(() => Promise.resolve());
  const ranking = {
    entries: vi.fn(),
    settings: vi.fn(),
    setSetting,
  } satisfies RankingInspection;
  return {
    ranking,
    queue: { enqueue } satisfies JobQueue,
    setSetting,
    enqueue,
  };
}

test.each([
  ["weight.freshness", "-0.1"],
  ["penalty.less_like_this", "-1"],
  ["mmr.lambda", "1.5"],
  ["explore.share", "0.6"],
  ["cap.per_source", "2.5"],
  ["cap.per_source", "0"],
  ["freshness.half_life_days", "0"],
  ["weight.freshness", "Infinity"],
  ["weight.freshness", "NaN"],
  ["weight.freshness", ""],
  ["weight.freshness", "abc"],
])("%s = %j is refused, with nothing written or queued", async (key, raw) => {
  const f = fakes();
  expect(await saveRankingSetting(f.ranking, f.queue, "u1", key, raw)).toEqual({
    ok: false,
    error: "out-of-range",
  });
  expect(f.setSetting).not.toHaveBeenCalled();
  expect(f.enqueue).not.toHaveBeenCalled();
});

test("an unknown key is refused", async () => {
  const f = fakes();
  for (const key of ["made.up", "weight.", "weight.has space"]) {
    expect(
      await saveRankingSetting(f.ranking, f.queue, "u1", key, "1"),
    ).toEqual({ ok: false, error: "unknown-key" });
  }
  expect(f.setSetting).not.toHaveBeenCalled();
});

test.each([
  ["weight.freshness", "2.5", 2.5],
  ["penalty.not_interested_concepts", "0", 0],
  ["mmr.lambda", "1", 1],
  ["explore.share", "0.5", 0.5],
  ["cap.per_source", "3", 3],
  ["freshness.half_life_days", "0.5", 0.5],
])(
  "%s = %s is saved and the owner's feed recomputes",
  async (key, raw, value) => {
    const f = fakes();
    expect(
      await saveRankingSetting(f.ranking, f.queue, "u1", key, raw),
    ).toEqual({
      ok: true,
      changed: true,
    });
    expect(f.setSetting).toHaveBeenCalledExactlyOnceWith(key, value);
    expect(f.enqueue).toHaveBeenCalledExactlyOnceWith(
      "recompute_feed",
      { user_id: "u1" },
      expect.anything(),
    );
  },
);

test("the same value again queues nothing", async () => {
  const f = fakes("unchanged");
  expect(
    await saveRankingSetting(f.ranking, f.queue, "u1", "weight.quality", "0.4"),
  ).toEqual({ ok: true, changed: false });
  expect(f.enqueue).not.toHaveBeenCalled();
});

test("a key the table lacks is refused", async () => {
  const f = fakes("missing");
  expect(
    await saveRankingSetting(f.ranking, f.queue, "u1", "weight.quality", "1"),
  ).toEqual({ ok: false, error: "unknown-key" });
  expect(f.enqueue).not.toHaveBeenCalled();
});
