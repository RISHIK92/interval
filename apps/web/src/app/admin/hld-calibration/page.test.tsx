import {
  type CalibrationCandidate,
  calibrationCandidates,
} from "@interval/hld";
import { calibrationSuggestions } from "@interval/hld/suggestions";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Actor, HldJudgements } from "../../../server/ports";
import { gradeCandidateAction } from "./actions";
import HldCalibrationPage from "./page";

// Owner decision 2026-11-24 (CANVAS-6, AI-5): Claude's suggested levels sit beside the
// grade inputs; only the owner's own save or accept stores a grade. One written for an
// earlier version of its design is marked outdated, never offered (Q-WD-32).
const admin: Actor = {
  userId: "owner-1",
  isGuest: false,
  betaGroup: "developer",
};
const calibrationGrades = vi.fn<HldJudgements["calibrationGrades"]>();
const grade = vi.fn<HldJudgements["grade"]>(() => Promise.resolve());
vi.mock("../../../server/container", () => ({
  sessionReader: () => ({ current: () => Promise.resolve(admin) }),
  entitlements: () => ({ can: () => Promise.resolve(true) }),
  hldJudgements: () => ({ calibrationGrades, grade }),
}));
// The designs whose suggestions a test makes outdated, as a changed design would.
const outdated = new Set<string>();
vi.mock("@interval/hld/suggestions", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("@interval/hld/suggestions")>();
  return {
    ...real,
    currentSuggestion: (c: CalibrationCandidate) =>
      outdated.has(c.id) ? "outdated" : real.currentSuggestion(c),
  };
});
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const ID = "url-shortener/reference";
const rubric = () => {
  const c = calibrationCandidates().find((x) => x.id === ID);
  if (c === undefined) throw new Error(`no ${ID}`);
  return c.input.rubric.map((r) => r.id);
};
const suggested = () => {
  const s = calibrationSuggestions().get(ID);
  if (s === undefined) throw new Error(`no suggestion for ${ID}`);
  return s.levels;
};
const render = async (filter?: string) =>
  renderToStaticMarkup(
    await HldCalibrationPage({
      searchParams: Promise.resolve(filter === undefined ? {} : { filter }),
    }),
  );
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

beforeEach(() => {
  outdated.clear();
  calibrationGrades.mockReset().mockResolvedValue(new Map());
  grade.mockClear();
});

describe("the calibration page", () => {
  test("shows each suggestion and its accept buttons, storing nothing", async () => {
    const html = await render();
    const first = suggested()[rubric()[0] ?? ""];
    if (first === undefined) throw new Error("no suggestion");
    expect(html).toContain(`Suggested (AI): ${String(first.level)}`);
    expect(html).toContain("Accept suggestion");
    expect(html).toContain("Accept all for this design");
    expect(html).toContain("(AI, provisional)");
    expect(grade).not.toHaveBeenCalled();
  });

  test("marks an outdated suggestion and offers none of it", async () => {
    outdated.add(ID);
    const html = await render();
    const card = html.slice(
      html.indexOf(`id="${ID}"`),
      html.indexOf('id="url-shortener/no-notes"'),
    );
    expect(card).toContain("suggestion is outdated");
    expect(card).not.toContain("Suggested (AI)");
    expect(card).not.toContain("Accept");
  });

  test("'Not graded yet' leaves out the fully graded designs", async () => {
    calibrationGrades.mockResolvedValue(
      new Map([[ID, Object.fromEntries(rubric().map((r) => [r, 2]))]]),
    );
    expect(await render()).toContain(`id="${ID}"`);
    const html = await render("ungraded");
    expect(html).not.toContain(`id="${ID}"`);
    expect(html).toContain('id="url-shortener/no-notes"');
  });
});

describe("accepting a suggestion", () => {
  test("stores that criterion at the suggested level, as the owner's grade", async () => {
    const [criterion] = rubric();
    if (criterion === undefined) throw new Error("no criterion");
    // The selects still say 4; the suggestion's level is what's stored.
    const fields = Object.fromEntries(rubric().map((r) => [`level:${r}`, "4"]));
    await expect(
      gradeCandidateAction(form({ id: ID, accept: criterion, ...fields })),
    ).rejects.toThrow(`redirect:/admin/hld-calibration?saved=`);
    expect(grade).toHaveBeenCalledWith(
      ID,
      { [criterion]: suggested()[criterion]?.level },
      admin.userId,
    );
  });

  test("'Accept all' stores every criterion's suggested level", async () => {
    await expect(
      gradeCandidateAction(form({ id: ID, accept: "*", filter: "ungraded" })),
    ).rejects.toThrow("redirect:/admin/hld-calibration?filter=ungraded&saved=");
    expect(grade).toHaveBeenCalledWith(
      ID,
      Object.fromEntries(rubric().map((r) => [r, suggested()[r]?.level])),
      admin.userId,
    );
  });

  test("an outdated suggestion can't be accepted", async () => {
    outdated.add(ID);
    await expect(
      gradeCandidateAction(form({ id: ID, accept: "*" })),
    ).rejects.toThrow("notFound");
    expect(grade).not.toHaveBeenCalled();
  });

  test("a criterion the design doesn't have stores nothing", async () => {
    await expect(
      gradeCandidateAction(form({ id: ID, accept: "nope" })),
    ).rejects.toThrow("notFound");
    expect(grade).not.toHaveBeenCalled();
  });

  test("saving without accepting stores the chosen levels", async () => {
    const fields = Object.fromEntries(rubric().map((r) => [`level:${r}`, "3"]));
    await expect(
      gradeCandidateAction(form({ id: ID, ...fields })),
    ).rejects.toThrow("redirect:");
    expect(grade).toHaveBeenCalledWith(
      ID,
      Object.fromEntries(rubric().map((r) => [r, 3])),
      admin.userId,
    );
  });
});
