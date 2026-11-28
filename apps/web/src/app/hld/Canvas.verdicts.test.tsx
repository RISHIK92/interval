// @vitest-environment jsdom
import {
  addComponent,
  connect,
  type Design,
  practiceProblems,
  starterDesign,
  updateNode,
} from "@interval/hld";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Canvas } from "./Canvas";

// ADR-0060 (owner, 2026-11-28): while the player builds, the canvas shows the problem's
// requirements and scenarios and the design's errors, and no verdict; a submit shows
// what passed and what failed, with the hints and coverage.
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}));
vi.mock("./practice/[slug]/actions", () => ({
  saveDesign: () => Promise.resolve({ ok: true, version: 1 }),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  // React Flow measures what it draws; jsdom has nothing to measure with.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

const SHORTENER = (() => {
  const p = practiceProblems(new Date()).find(
    (x) => x.slug === "url-shortener",
  );
  if (p === undefined) throw new Error("no url-shortener practice problem");
  return p;
})();

// A valid design for the shortener that passes a normal day and fails a zone outage.
function built(): Design {
  let d = starterDesign(SHORTENER.spec);
  for (const k of ["load_balancer", "app_service", "sql_db"] as const)
    d = addComponent(d, k, { x: 0, y: 0 });
  const [users, lb, app, db] = d.nodes.map((n) => n.id);
  if (
    users === undefined ||
    lb === undefined ||
    app === undefined ||
    db === undefined
  )
    throw new Error("nodes missing");
  d = connect(d, SHORTENER, users, lb);
  d = connect(d, SHORTENER, lb, app);
  d = connect(d, SHORTENER, app, db);
  d = updateNode(d, app, { config: { nodes: 12 } });
  return updateNode(d, db, { config: { readReplicas: 8, storageGb: 1_000 } });
}

let root: Root | null = null;
afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  refresh.mockClear();
});

function show(
  initial: Design,
  mode: Parameters<typeof Canvas>[0]["mode"],
): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <Canvas
        problem={SHORTENER}
        initial={initial}
        version={0}
        mode={mode}
        header={<h1>URL shortener</h1>}
      />,
    );
  });
  return host;
}

const PRACTICE = { kind: "practice", feedback: null } as const;
const MARKS = ["Passed", "Partly met", "Failed", "At risk"];
const marks = (host: HTMLElement) =>
  [...host.querySelectorAll("[aria-label]")]
    .map((e) => e.getAttribute("aria-label") ?? "")
    .filter((l) => MARKS.includes(l));
const button = (host: HTMLElement, text: string) => {
  const found = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === text,
  );
  if (found === undefined) throw new Error(`no "${text}" button`);
  return found;
};

// No verdict of any kind: points, baseline, marks, coverage or hints.
function expectNoVerdicts(host: HTMLElement) {
  const text = host.textContent;
  expect(text).not.toContain("simulation points");
  expect(text).not.toMatch(/baseline (not )?passed/);
  expect(text).not.toMatch(/\d+ of \d+ covered/);
  expect(text).not.toContain("Nothing covers this yet");
  expect(text).not.toContain("Hints");
  expect(text).not.toContain("can't keep up");
  expect(marks(host)).toEqual([]);
}

test("while building: the requirements, each scenario and what it injects, no verdicts", () => {
  const host = show(built(), PRACTICE);
  const text = host.textContent;
  for (const r of SHORTENER.requirements) expect(text).toContain(r);
  for (const s of SHORTENER.scenarios) expect(text).toContain(s.name);
  expect(text).toContain("Normal traffic");
  expect(text).toContain("3× the traffic");
  expect(text).toContain("A zone goes down");
  expectNoVerdicts(host);
});

test("while building, a design's errors show, and it can't be submitted", () => {
  const host = show(
    addComponent(built(), "search_index", { x: 0, y: 0 }),
    PRACTICE,
  );
  expect(host.textContent).toContain("Fix these to save the design:");
  expect(host.textContent).toContain("doesn't allow a search index");
  expect(button(host, "Submit the design").disabled).toBe(true);
  expectNoVerdicts(host);
});

test("practice: a submit shows what passed and failed, with coverage and hints; an edit hides them", () => {
  const host = show(built(), PRACTICE);
  act(() => {
    button(host, "Submit the design").click();
  });
  const text = host.textContent;
  expect(text).toContain("of 60 simulation points");
  expect(text).toMatch(/\d+ of 5 covered/);
  expect(text).toContain("Hints");
  expect(marks(host).length).toBeGreaterThanOrEqual(SHORTENER.scenarios.length);
  expect(marks(host)).toContain("Passed");
  expect(marks(host)).toContain("Failed");
  // Any edit, here a component added, and the verdicts wait for the next submit.
  act(() => {
    host.querySelector<HTMLButtonElement>('[aria-label="Add Cache"]')?.click();
  });
  expectNoVerdicts(host);
  // As often as the player likes.
  act(() => {
    button(host, "Submit the design").click();
  });
  expect(host.textContent).toContain("of 60 simulation points");
});

test("a match: no verdicts before the submit, the submission's verdicts after it", async () => {
  const deadline = new Date(Date.now() + 30 * 60_000).toISOString();
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve(
        url.endsWith("/submit")
          ? Response.json({ result: "submitted" })
          : Response.json({ phase: "playing" }),
      ),
    ),
  );
  const host = show(built(), {
    kind: "match",
    matchId: "m1",
    deadline,
    submitted: false,
    submission: null,
  });
  expectNoVerdicts(host);
  await act(async () => {
    button(host, "Submit the design").click();
    await Promise.resolve();
  });
  await act(() => Promise.resolve());
  expect(host.textContent).toContain("Submitted.");
  expect(host.textContent).toContain("of 60 simulation points");
  expect(marks(host)).toContain("Failed");
});

const DEADLINE = new Date(Date.now() + 30 * 60_000).toISOString();
const match = (submission: Design | null, submitted = submission !== null) =>
  ({
    kind: "match",
    matchId: "m1",
    deadline: DEADLINE,
    submitted,
    submission,
  }) as const;

test("a match reopened after its submit shows the submission's verdicts", () => {
  const host = show(built(), match(built()));
  expect(host.textContent).toContain("Submitted.");
  expect(host.textContent).toContain("of 60 simulation points");
  expect(host.textContent).toMatch(/\d+ of 5 covered/);
});

// The page passes no submission when the stored one can't be read: still submitted.
test("a submitted match whose submission can't be read says submitted, with no verdicts", () => {
  const host = show(built(), match(null, true));
  expect(host.textContent).toContain("Submitted.");
  expectNoVerdicts(host);
});

test("submitted from another tab: no verdicts until the refresh brings the submission", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve(
        url.endsWith("/submit")
          ? Response.json({ result: "already" }, { status: 409 })
          : Response.json({ phase: "playing" }),
      ),
    ),
  );
  const host = show(built(), match(null));
  await act(async () => {
    button(host, "Submit the design").click();
    await Promise.resolve();
  });
  await act(() => Promise.resolve());
  expect(host.textContent).toContain("Submitted.");
  expect(refresh).toHaveBeenCalled();
  expectNoVerdicts(host);
  // The refreshed page carries the submission as stored.
  act(() => {
    root?.render(
      <Canvas
        problem={SHORTENER}
        initial={built()}
        version={0}
        mode={match(built())}
        header={<h1>URL shortener</h1>}
      />,
    );
  });
  expect(host.textContent).toContain("of 60 simulation points");
});

// The database (failover none) goes down in "A zone goes down": its failover is at risk.
function selectDatabase(host: HTMLElement) {
  const db = built().nodes.find((n) => n.kind === "sql_db");
  const el = host.querySelector<HTMLElement>(
    `.react-flow__node[data-id="${db?.id ?? ""}"]`,
  );
  if (el === null) throw new Error("no database on the canvas");
  act(() => {
    el.click();
  });
  expect(host.textContent).toContain("SQL database · primary");
}
const atRisk = (host: HTMLElement) =>
  marks(host).filter((m) => m === "At risk").length;

test("a selected component shows no risks while building, and its risks after a submit", () => {
  const host = show(built(), PRACTICE);
  selectDatabase(host);
  expect(atRisk(host)).toBe(0);
  act(() => {
    button(host, "Submit the design").click();
  });
  expect(atRisk(host)).toBeGreaterThan(0);
});

test("a match's risks go once the submitted component is edited", () => {
  const host = show(built(), match(built()));
  selectDatabase(host);
  expect(atRisk(host)).toBeGreaterThan(0);
  expect(host.textContent).toContain("Goes down in");
  const failover = [...host.querySelectorAll("select")].find((e) =>
    [...e.options].some((o) => o.value === "multi_zone"),
  );
  if (failover === undefined) throw new Error("no failover setting");
  act(() => {
    failover.value = "multi_zone";
    failover.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(atRisk(host)).toBe(0);
  expect(host.textContent).not.toContain("Goes down in");
  // The submission's own verdicts stay.
  expect(host.textContent).toContain("of 60 simulation points");
});
