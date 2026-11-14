import { starterDesign, practiceProblems } from "@interval/hld";
import { beforeEach, expect, test, vi } from "vitest";
import type {
  Actor,
  Entitlements,
  HldPracticeDesigns,
} from "../../../../server/ports";

// The first practice problem (P6-W40: each family's practice seed).
const URL_SHORTENER = (() => {
  const p = practiceProblems().find((x) => x.slug === "url-shortener");
  if (p === undefined) throw new Error("no url-shortener practice problem");
  return p;
})();

// P6-W39 (ADR-0042 PROPOSED, Q-P6-03): the canvas's autosave checks everything it's sent.
const current = vi.fn<(headers: Headers) => Promise<Actor | null>>();
const can = vi.fn<Entitlements["can"]>(() => Promise.resolve(true));
const save = vi.fn<HldPracticeDesigns["save"]>(() => Promise.resolve(3));
vi.mock("../../../../server/container", () => ({
  sessionReader: () => ({ current }),
  entitlements: () => ({ can }),
  hldPracticeDesigns: () => ({ save }),
}));
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
}));

const { saveDesign } = await import("./actions");
const ada: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };
const slug = URL_SHORTENER.slug;

beforeEach(() => {
  current.mockResolvedValue(ada);
  can.mockResolvedValue(true);
  save.mockClear();
});

test("a valid design saves over the version it was made from", async () => {
  expect(await saveDesign(slug, starterDesign(), 2)).toEqual({
    ok: true,
    version: 3,
  });
  expect(save).toHaveBeenCalledWith("u1", slug, starterDesign(), 2);
});

test("a stale save is reported, not forced", async () => {
  save.mockResolvedValueOnce(null);
  expect(await saveDesign(slug, starterDesign(), 1)).toEqual({
    ok: false,
    reason: "stale",
  });
});

test.each([
  ["an unknown problem", "no-such-problem", starterDesign(), 0],
  ["a design that doesn't parse", slug, { ...starterDesign(), nodes: [] }, 0],
  ["a negative version", slug, starterDesign(), -1],
  ["a version that isn't a number", slug, starterDesign(), "2"],
  ["a version past the column's range", slug, starterDesign(), 2 ** 31],
  [
    "a component the problem doesn't allow",
    slug,
    {
      ...starterDesign(),
      nodes: [
        ...starterDesign().nodes,
        {
          id: "q",
          kind: "queue",
          config: { partitions: 1, retentionHours: 1, zones: 1, regions: 1 },
          note: "",
        },
      ],
    },
    0,
  ],
])("%s is refused and nothing is saved", async (_, s, d, v) => {
  expect(await saveDesign(s, d, v)).toEqual({ ok: false, reason: "invalid" });
  expect(save).not.toHaveBeenCalled();
});

test("without a session or the capability, nothing is saved", async () => {
  current.mockResolvedValueOnce(null);
  expect(await saveDesign(slug, starterDesign(), 0)).toEqual({
    ok: false,
    reason: "signed-out",
  });
  can.mockResolvedValueOnce(false);
  expect(await saveDesign(slug, starterDesign(), 0)).toEqual({
    ok: false,
    reason: "forbidden",
  });
  expect(can).toHaveBeenCalledWith("u1", "play.hld");
  expect(save).not.toHaveBeenCalled();
});
