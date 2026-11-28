import {
  addComponent,
  type Design,
  practiceProblems,
  starterDesign,
} from "@interval/hld";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import type { Actor, HldSeat } from "../../../../server/ports";

// ADR-0060: once a player has submitted, their match page draws the submission and
// shows its verdicts; one that can't be read is logged, and the page still says
// submitted, with no verdicts.
const PROBLEM = (() => {
  const p = practiceProblems(new Date()).find(
    (x) => x.slug === "url-shortener",
  );
  if (p === undefined) throw new Error("no url-shortener problem");
  return p;
})();
const ID = "0b6f3c1e-2a4d-4e5f-8a9b-0c1d2e3f4a5b";
const ada: Actor = { userId: "u1", isGuest: false, betaGroup: "student" };
const autosave = addComponent(starterDesign(PROBLEM.spec), "cache", {
  x: 0,
  y: 0,
});
const submitted = addComponent(starterDesign(PROBLEM.spec), "sql_db", {
  x: 0,
  y: 0,
});

const seat = vi.fn<() => Partial<HldSeat>>();
const warn = vi.fn();
vi.mock("../../../../server/container", () => ({
  sessionReader: () => ({ current: () => Promise.resolve(ada) }),
  entitlements: () => ({ can: () => Promise.resolve(true) }),
  hldDeps: () => ({}),
  hldMatches: () => ({
    get: () =>
      Promise.resolve({
        match: {
          id: ID,
          closedAt: null,
          deadlineAt: new Date(Date.now() + 30 * 60_000),
          unrated: false,
          battleMode: "ranked",
        },
        seats: [{ userId: "u1", player: "ada", ...seat() }],
      }),
    latestVersion: () => Promise.resolve({ design: autosave, version: 3 }),
  }),
}));
vi.mock("../../../../server/hld-matches", () => ({
  advance: () => Promise.resolve(),
  problemOf: () => PROBLEM,
}));
vi.mock("../../../../server/hld-match-requests", () => ({
  matchProgress: () => Promise.resolve({ opponents: [] }),
}));
vi.mock("../../../../server/log", () => ({ log: { warn } }));
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
type Props = {
  header: ReactNode;
  initial: Design;
  mode: { submitted: boolean; submission: Design | null };
};
const canvas = vi.fn<(props: Props) => void>();
vi.mock("../../Canvas", () => ({
  Canvas: (props: Props) => {
    canvas(props);
    return null;
  },
}));

const { default: HldMatchPage } = await import("./page");
const open = async () => {
  renderToStaticMarkup(
    await HldMatchPage({ params: Promise.resolve({ id: ID }) }),
  );
  const props = canvas.mock.calls.at(-1)?.[0];
  if (props === undefined) throw new Error("no canvas");
  return props;
};

beforeEach(() => {
  canvas.mockClear();
  warn.mockClear();
});

test("before the submit: the last autosave, and no submission", async () => {
  seat.mockReturnValue({ submittedAt: null, design: null });
  const props = await open();
  expect(props.initial).toEqual(autosave);
  expect(props.mode).toMatchObject({ submitted: false, submission: null });
});

test("after the submit: the submission is drawn and its verdicts shown", async () => {
  seat.mockReturnValue({ submittedAt: new Date(), design: submitted });
  const props = await open();
  expect(props.initial).toEqual(submitted);
  expect(props.mode).toMatchObject({ submitted: true, submission: submitted });
  expect(warn).not.toHaveBeenCalled();
});

test("a submission that can't be read is logged; still submitted, no verdicts", async () => {
  seat.mockReturnValue({ submittedAt: new Date(), design: { nodes: "?" } });
  const props = await open();
  expect(props.initial).toEqual(autosave);
  expect(props.mode).toMatchObject({ submitted: true, submission: null });
  expect(warn).toHaveBeenCalledWith("hld: submitted design unreadable", {
    matchId: ID,
    userId: "u1",
  });
});
