import {
  addComponent,
  connect,
  type Design,
  FAMILIES,
  starterDesign,
  variant,
} from "@interval/hld";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  advance,
  groupHldWindow,
  type HldDeps,
  JUDGE_WAIT_MS,
  problemOf,
  startHldMatch,
  submitDesign,
} from "./hld-matches";
import type {
  HldJudgement,
  HldJudgements,
  HldMatch,
  HldMatches,
  HldSeat,
  JobQueue,
} from "./ports";

// P6-W42 (§6.4, Q-P6-06, ADR-0043): an HLD match moved on by whoever looks at it: closed
// at its deadline (the last version submitted for anyone who hadn't), scored once the
// judgements are in or after 15 minutes, then rated.

type Row = { match: HldMatch; seats: HldSeat[]; versions: Map<string, Design> };

function fakes(clock: { now: Date }) {
  const rows = new Map<string, Row>();
  const judgements = new Map<
    string,
    HldJudgement & { userId: string; matchId: string }
  >();
  let n = 0;
  const matches: HldMatches = {
    create: (players, v, o) => {
      const id = `m${String(++n)}`;
      rows.set(id, {
        match: {
          id,
          ...v,
          unrated: o.unrated,
          windowAt: o.windowAt,
          startedAt: clock.now,
          deadlineAt: new Date(clock.now.getTime() + o.minutes * 60_000),
          closedAt: null,
          scoredAt: null,
          rubricIncluded: null,
          ratedAt: null,
        },
        seats: players.map((userId) => ({
          userId,
          player: userId,
          submittedAt: null,
          autoSubmitted: false,
          simulationPoints: null,
          baselinePassed: null,
          speedPoints: null,
          judgementId: null,
          design: null,
          total: null,
          place: null,
        })),
        versions: new Map(),
      });
      return Promise.resolve(id);
    },
    get: (id) => {
      const r = rows.get(id);
      return Promise.resolve(
        r === undefined
          ? null
          : { match: { ...r.match }, seats: r.seats.map((s) => ({ ...s })) },
      );
    },
    saveVersion: () => Promise.resolve(1),
    latestVersion: (id, userId) => {
      const d = rows.get(id)?.versions.get(userId);
      return Promise.resolve(
        d === undefined ? null : { design: d, version: 1 },
      );
    },
    submit: (id, userId, s) => {
      const seat = rows.get(id)?.seats.find((x) => x.userId === userId);
      if (seat === undefined || seat.submittedAt !== null)
        return Promise.resolve(false);
      Object.assign(seat, {
        submittedAt: s.at,
        autoSubmitted: s.auto,
        simulationPoints: s.simulationPoints,
        baselinePassed: s.baselinePassed,
        speedPoints: s.speedPoints,
        design: s.design,
      });
      return Promise.resolve(true);
    },
    claimJudgement: (id, userId, judgementId) => {
      const seat = rows.get(id)?.seats.find((x) => x.userId === userId);
      if (seat === undefined || seat.judgementId !== null)
        return Promise.resolve(false);
      seat.judgementId = judgementId;
      return Promise.resolve(true);
    },
    releaseJudgement: (id, userId, judgementId) => {
      const seat = rows.get(id)?.seats.find((x) => x.userId === userId);
      if (seat?.judgementId === judgementId) seat.judgementId = null;
      return Promise.resolve();
    },
    close: (id, at) => {
      const r = rows.get(id);
      if (r === undefined || r.match.closedAt !== null)
        return Promise.resolve(false);
      r.match.closedAt = at;
      return Promise.resolve(true);
    },
    score: (id, included, standings, at) => {
      const r = rows.get(id);
      if (r === undefined || r.match.scoredAt !== null)
        return Promise.resolve(false);
      r.match.scoredAt = at;
      r.match.rubricIncluded = included;
      for (const s of standings)
        Object.assign(r.seats.find((x) => x.userId === s.userId) ?? {}, {
          total: s.total,
          place: s.place,
        });
      return Promise.resolve(true);
    },
    ratingOf: () => Promise.resolve(1500),
    ratingChanges: () => Promise.resolve(new Map()),
    unscoredFor: () => Promise.resolve([]),
    retired: () => Promise.resolve(new Set<string>()),
    versions: () => Promise.resolve([]),
  };
  const judge: HldJudgements = {
    request: (userId, _slug, _input, baselinePassed, matchId) => {
      const id = `j${String(++n)}`;
      judgements.set(id, {
        id,
        userId,
        matchId: matchId ?? "",
        problemSlug: "",
        status: "pending",
        baselinePassed,
        levels: null,
        coach: null,
        requestedAt: clock.now,
        appealedAt: null,
        ownerLevels: null,
      });
      return Promise.resolve({ id, created: true });
    },
    drop: () => Promise.resolve(),
    latest: () => Promise.resolve(null),
    ofMatch: (matchId) =>
      Promise.resolve(
        [...judgements.values()].filter((j) => j.matchId === matchId),
      ),
    get: () => Promise.resolve(null),
    appeal: () => Promise.resolve(null),
    openAppeals: () => Promise.resolve([]),
    appealRate: () => Promise.resolve({ appealed: 0, judged: 0 }),
    resolve: () => Promise.resolve(false),
    calibrationGrades: () => Promise.resolve(new Map()),
    grade: () => Promise.resolve(),
  };
  return { rows, judgements, matches, judge };
}

const clock = { now: new Date("2026-11-16T10:00:00Z") };
const later = (minutes: number) => {
  clock.now = new Date(clock.now.getTime() + minutes * 60_000);
};
let world: ReturnType<typeof fakes>;
let deps: HldDeps;
const enqueue = vi.fn<JobQueue["enqueue"]>(() => Promise.resolve());

beforeEach(() => {
  clock.now = new Date("2026-11-16T10:00:00Z");
  world = fakes(clock);
  enqueue.mockClear();
  deps = {
    matches: world.matches,
    judgements: world.judge,
    queue: { enqueue }, // only enqueue is used here
    now: () => clock.now,
    random: () => 0,
  };
});

// A design that passes the baseline of whichever problem the match drew: its reference.
async function sound(matchId: string): Promise<Design> {
  const found = await world.matches.get(matchId);
  const family = FAMILIES.find((f) => f.slug === found?.match.family);
  if (found === null || family === undefined) throw new Error("no match");
  return variant(family, found.match.league, found.match.seed).reference;
}

const judged = (level: number) => {
  for (const j of world.judgements.values()) {
    j.status = "ready";
    j.levels = Object.fromEntries(
      problemOf(
        world.rows.values().next().value?.match ?? ({} as HldMatch),
      ).rubric.map((c) => [c.id, { level, reason: "" }]),
    );
  }
};

describe("an HLD match", () => {
  test("submitted by both, judged, scored with places, and queued for rating", async () => {
    const id = await startHldMatch(deps, ["ada", "bob"], "human", {
      unrated: false,
      windowAt: null,
    });
    const design = await sound(id);
    later(5);
    expect(await submitDesign(deps, id, "ada", design)).toBe("submitted");
    expect(await submitDesign(deps, id, "ada", design)).toBe("already");
    later(5);
    expect(await submitDesign(deps, id, "bob", starterDesign())).toBe(
      "submitted",
    );
    const row = world.rows.get(id);
    expect(row?.match.closedAt).not.toBeNull();
    expect(row?.match.scoredAt).toBeNull(); // the judgements are pending
    expect(enqueue).toHaveBeenCalledWith(
      "judge_hld",
      expect.objectContaining({}),
      expect.objectContaining({}),
    );
    judged(4);
    await advance(deps, id);
    expect(row?.match.rubricIncluded).toBe(true);
    const ada = row?.seats.find((s) => s.userId === "ada");
    const bob = row?.seats.find((s) => s.userId === "bob");
    expect(ada?.place).toBe(1);
    expect(ada?.speedPoints).toBeGreaterThan(0);
    // The empty design fails the baseline: no rubric or speed, however it was graded.
    expect(bob).toMatchObject({
      baselinePassed: false,
      speedPoints: 0,
      place: 2,
    });
    expect(enqueue).toHaveBeenLastCalledWith(
      "rate_hld_match",
      { match_id: id },
      { idempotencyKey: `hld-rate-${id}` },
    );
  });

  test("at the deadline, the last version is submitted for whoever hadn't", async () => {
    const id = await startHldMatch(deps, ["ada", "bob"], "human", {
      unrated: false,
      windowAt: null,
    });
    const draft = connect(
      addComponent(starterDesign(), "app_service", { x: 0, y: 0 }),
      problemOf(world.rows.get(id)?.match ?? ({} as HldMatch)),
      "users",
      "app-service",
    );
    world.rows.get(id)?.versions.set("ada", draft);
    await advance(deps, id);
    expect(world.rows.get(id)?.match.closedAt).toBeNull(); // not yet
    later(31);
    expect(await submitDesign(deps, id, "bob", starterDesign())).toBe("closed");
    await advance(deps, id);
    const row = world.rows.get(id);
    expect(row?.match.closedAt).not.toBeNull();
    expect(
      row?.seats.every((s) => s.autoSubmitted && s.speedPoints === 0),
    ).toBe(true);
  });

  test("a judgement still missing after 15 minutes leaves the rubric out for everyone", async () => {
    const id = await startHldMatch(deps, ["ada", "bob"], "human", {
      unrated: false,
      windowAt: null,
    });
    const design = await sound(id);
    await submitDesign(deps, id, "ada", design);
    await submitDesign(deps, id, "bob", design);
    later(JUDGE_WAIT_MS / 60_000 - 1);
    await advance(deps, id);
    expect(world.rows.get(id)?.match.scoredAt).toBeNull();
    later(2);
    await advance(deps, id);
    expect(world.rows.get(id)?.match.rubricIncluded).toBe(false);
  });

  test("an unrated or solo match is scored but never rated", async () => {
    const id = await startHldMatch(deps, ["ada"], "ai", {
      unrated: true,
      windowAt: null,
    });
    await submitDesign(deps, id, "ada", starterDesign());
    judged(0);
    await advance(deps, id);
    expect(world.rows.get(id)?.match.scoredAt).not.toBeNull();
    expect(enqueue).not.toHaveBeenCalledWith(
      "rate_hld_match",
      expect.anything(),
      expect.anything(),
    );
  });

  test("a judgement that couldn't be queued is asked again on the next look", async () => {
    const id = await startHldMatch(deps, ["ada", "bob"], "human", {
      unrated: false,
      windowAt: null,
    });
    enqueue.mockRejectedValueOnce(new Error("queue down"));
    await expect(
      submitDesign(deps, id, "ada", await sound(id)),
    ).rejects.toThrow("queue down");
    expect(
      world.rows.get(id)?.seats.find((s) => s.userId === "ada")?.judgementId,
    ).toBeNull();
    await advance(deps, id);
    expect(
      world.rows.get(id)?.seats.find((s) => s.userId === "ada")?.judgementId,
    ).not.toBeNull();
    expect(enqueue).toHaveBeenLastCalledWith(
      "judge_hld",
      expect.anything(),
      expect.anything(),
    );
  });

  test("a scored match's ratings are queued again until it's rated", async () => {
    const id = await startHldMatch(deps, ["ada", "bob"], "human", {
      unrated: false,
      windowAt: null,
    });
    await submitDesign(deps, id, "ada", starterDesign());
    enqueue.mockImplementation((name) =>
      name === "rate_hld_match"
        ? Promise.reject(new Error("queue down"))
        : Promise.resolve(),
    );
    await expect(
      submitDesign(deps, id, "bob", starterDesign()),
    ).rejects.toThrow("queue down");
    enqueue.mockImplementation(() => Promise.resolve());
    await advance(deps, id);
    expect(enqueue).toHaveBeenLastCalledWith(
      "rate_hld_match",
      { match_id: id },
      { idempotencyKey: `hld-rate-${id}` },
    );
  });

  test("a window's registrants are grouped into rooms of up to 4 on its variant", async () => {
    const assigned: string[][] = [];
    const players = ["a", "b", "c", "d", "e"].map((userId, i) => ({
      userId,
      rating: 30 - i,
    }));
    const result = await groupHldWindow(
      {
        ...deps,
        windows: {
          register: () => Promise.resolve(),
          unregister: () => Promise.resolve(),
          registration: () => Promise.resolve(null),
          claim: () =>
            Promise.resolve({ variant: { family: "chat", seed: 3 }, players }),
          extend: () => Promise.resolve(),
          assign: (_at, _league, _id, users) => {
            assigned.push(users);
            return Promise.resolve();
          },
        },
      },
      clock.now,
      "human",
    );
    expect(assigned).toEqual([["a", "b", "c", "d"], ["e"]]);
    expect(result).toEqual({ grouped: 5, matched: 4 });
    const matches = [...world.rows.values()].map((r) => r.match);
    expect(matches.map((m) => [m.family, m.seed, m.unrated])).toEqual([
      ["chat", 3, false],
      ["chat", 3, true], // alone: solo, unranked
    ]);
  });

  test("someone else's match, or a design for another problem, is refused", async () => {
    const id = await startHldMatch(deps, ["ada"], "human", {
      unrated: true,
      windowAt: null,
    });
    expect(await submitDesign(deps, id, "eve", starterDesign())).toBe(
      "not_player",
    );
    const queue = {
      id: "q",
      kind: "queue" as const,
      config: { partitions: 1, retentionHours: 1, zones: 1, regions: 1 },
      note: "",
    };
    const allowed = problemOf(
      world.rows.get(id)?.match ?? ({} as HldMatch),
    ).allowedComponents;
    if (!allowed.includes("queue"))
      expect(
        await submitDesign(deps, id, "ada", {
          ...starterDesign(),
          nodes: [...starterDesign().nodes, queue],
        }),
      ).toBe("invalid");
    expect(await submitDesign(deps, id, "ada", { nodes: [] })).toBe("invalid");
  });
});
