"use client";

import {
  addComponent,
  check,
  fitsProblem,
  type ComponentKind,
  configFields,
  connect,
  type Design,
  type HldProblem,
  hints,
  NOTE_MAX,
  removeNode,
  setRoutes,
  simulate,
  updateNode,
} from "@interval/hld";
import {
  Background,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  ReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Feedback } from "./Feedback";
import { FIT, FitOnGrow, ZoomControls } from "./FlowControls";
import { flowTheme, NODE_STYLE, NodeLabel, SELECTED_NODE } from "./flow";
import { MatchPanel } from "./MatchPanel";
import { freeSpot } from "./placement";
import type { FeedbackView } from "./practice/feedback";
import { saveDesign } from "./practice/[slug]/actions";

// P6-W39 (CANVAS-1, CANVAS-2, CANVAS-5; Q-P6-03): the HLD canvas. The design is the one
// state; React Flow draws it, and every edit goes through packages/hld's pure functions.
// The preview simulation runs here, in the browser, on every valid draft, with hints by
// rule; the design autosaves about 2 s after the last change.

const SAVE_AFTER_MS = 2_000;
const label = (kind: string) => kind.replaceAll("_", " ");

type Selection = { node: string } | { from: string; to: string } | null;
// P6-W42: practice (the AI feedback on request) or a match (its clock and submission).
export type CanvasMode =
  | { kind: "practice"; feedback: FeedbackView | null }
  | { kind: "match"; matchId: string; deadline: string; submitted: boolean };
type SaveState = "saved" | "saving" | "waiting" | "stale" | "failed" | "closed";

export function Canvas({
  problem,
  initial,
  version: loadedVersion,
  mode,
}: {
  problem: HldProblem;
  initial: Design;
  version: number;
  mode: CanvasMode;
}) {
  const [design, setDesign] = useState(initial);
  const [selected, setSelected] = useState<Selection>(null);
  // React Flow measures each node once drawn; a controlled node must carry it back.
  const [sizes, setSizes] = useState<
    Record<string, { width: number; height: number }>
  >({});
  const [save, setSave] = useState<SaveState>("saved");
  const version = useRef(loadedVersion);
  const savedJson = useRef(JSON.stringify(initial));
  // Once another tab has saved over us, nothing more is saved from here.
  const stale = useRef(false);
  // One save at a time: a second one would name the version the first is replacing,
  // and be refused as stale. A change made meanwhile is saved once it settles.
  const inFlight = useRef(false);
  const [settled, setSettled] = useState(0);
  // A design the server refused (not as stale) isn't sent again until it changes.
  const refusedJson = useRef<string | null>(null);

  // What the server would refuse: the design's own checks, then the problem's.
  const issues = useMemo(() => {
    const own = check(design);
    return own.length > 0 ? own : fitsProblem(design, problem);
  }, [design, problem]);
  // Dragging changes the design on every frame; the preview follows when React can.
  const previewed = useDeferredValue(design);
  const result = useMemo(
    () =>
      check(previewed).length === 0 &&
      fitsProblem(previewed, problem).length === 0
        ? simulate(problem, previewed)
        : null,
    [problem, previewed],
  );
  const advice = useMemo(
    () => (result === null ? [] : hints(problem, result)),
    [problem, result],
  );

  useEffect(() => {
    const json = JSON.stringify(design);
    if (stale.current || inFlight.current) return;
    if (json === savedJson.current) {
      setSave("saved");
      return;
    }
    if (issues.length > 0 || json === refusedJson.current) return;
    setSave("waiting");
    const timer = setTimeout(() => {
      inFlight.current = true;
      setSave("saving");
      (mode.kind === "match"
        ? fetch(`/api/hld/match/${mode.matchId}/design`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ design, base: version.current }),
          }).then(async (r) => {
            // 200 a save, 400 or 409 a refusal with its reason; anything else failed.
            if (![200, 400, 409].includes(r.status))
              throw new Error(`autosave: ${String(r.status)}`);
            return (await r.json()) as
              | { ok: true; version: number }
              | { ok: false; reason: "invalid" | "stale" | "closed" };
          })
        : saveDesign(problem.slug, design, version.current)
      )
        .then((r) => {
          if (r.ok) {
            version.current = r.version;
            savedJson.current = json;
            setSave("saved");
          } else {
            stale.current = r.reason === "stale" || r.reason === "closed";
            refusedJson.current = json;
            console.error("HLD autosave refused", r.reason);
            setSave(
              r.reason === "closed"
                ? "closed"
                : stale.current
                  ? "stale"
                  : "failed",
            );
          }
        })
        .catch((error: unknown) => {
          refusedJson.current = json;
          console.error("HLD autosave failed", error);
          setSave("failed");
        })
        .finally(() => {
          inFlight.current = false;
          setSettled((n) => n + 1);
        });
    }, SAVE_AFTER_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [design, issues, problem.slug, settled, mode]);

  const edgeId = (e: { from: string; to: string }) => `${e.from}->${e.to}`;
  const nodes: Node[] = design.nodes.map((n) => {
    const size = sizes[n.id];
    const chosen =
      selected !== null && "node" in selected && selected.node === n.id;
    return {
      id: n.id,
      position: n.position ?? { x: 0, y: 0 },
      data: { label: <NodeLabel id={n.id} kind={n.kind} /> },
      style: NODE_STYLE,
      deletable: n.kind !== "client",
      selected: chosen,
      ...(chosen ? { className: SELECTED_NODE } : {}),
      ...(size === undefined ? {} : { measured: size }),
    };
  });
  const edges: Edge[] = design.edges.map((e) => ({
    id: edgeId(e),
    source: e.from,
    target: e.to,
    label: e.routes.join(", "),
    selected:
      selected !== null &&
      "from" in selected &&
      selected.from === e.from &&
      selected.to === e.to,
  }));

  const onNodesChange = (changes: NodeChange[]) => {
    for (const c of changes) {
      if (c.type === "dimensions" && c.dimensions !== undefined) {
        const size = c.dimensions;
        setSizes((s) => ({ ...s, [c.id]: size }));
      }
      if (c.type === "select" && c.selected) setSelected({ node: c.id });
    }
    setDesign((d) =>
      changes.reduce((acc, c) => {
        if (c.type === "position" && c.position !== undefined)
          return updateNode(acc, c.id, { position: c.position });
        if (c.type === "remove") return removeNode(acc, c.id);
        return acc;
      }, d),
    );
  };
  const onEdgesChange = (changes: EdgeChange[]) => {
    setDesign((d) =>
      changes.reduce((acc, c) => {
        if (c.type !== "remove") return acc;
        const e = acc.edges.find((x) => edgeId(x) === c.id);
        return e === undefined ? acc : setRoutes(acc, e.from, e.to, []);
      }, d),
    );
  };

  const kinds = problem.allowedComponents.filter(
    (k): k is Exclude<ComponentKind, "client"> => k !== "client",
  );
  const node =
    selected !== null && "node" in selected
      ? design.nodes.find((n) => n.id === selected.node)
      : undefined;
  const edge =
    selected !== null && "from" in selected
      ? design.edges.find(
          (e) => e.from === selected.from && e.to === selected.to,
        )
      : undefined;

  // The parts go into the page's frame (Frame.tsx): the canvas in the middle, the
  // selection and the submission on the right, the simulation under the requirements.
  return (
    <>
      <section className="flex flex-col gap-2 lg:col-start-2 lg:row-span-2 lg:row-start-2 lg:min-w-0 lg:gap-3 lg:p-5">
        <div
          className="flex flex-wrap gap-2 lg:order-2 lg:items-center lg:gap-1.5"
          role="toolbar"
          aria-label="Add a component"
        >
          <span className="mr-1 hidden text-[13px] text-ink-muted lg:inline">
            Add
          </span>
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              className="rounded-full bg-well px-3 py-1.5 text-sm font-medium hover:bg-track lg:h-8 lg:rounded-full lg:border-0 lg:bg-well lg:px-3 lg:py-0 lg:text-[13px] lg:font-medium lg:hover:bg-track"
              onClick={() => {
                const d = addComponent(design, k, freeSpot(design.nodes));
                setDesign(d);
                const added = d.nodes.at(-1);
                if (added !== undefined) setSelected({ node: added.id });
              }}
            >
              <span className="lg:hidden">+ </span>
              {label(k)}
            </button>
          ))}
        </div>
        <div
          className="h-[60vh] min-h-96 overflow-hidden rounded-[20px] border border-hairline lg:order-1 lg:min-h-[400px] lg:overflow-hidden lg:rounded-[20px] lg:border-hairline"
          style={flowTheme}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={(c) => {
              setDesign((d) => connect(d, problem, c.source, c.target));
            }}
            onNodeClick={(_, n) => {
              setSelected({ node: n.id });
            }}
            onEdgeClick={(_, e) => {
              setSelected({ from: e.source, to: e.target });
            }}
            onPaneClick={() => {
              setSelected(null);
            }}
            fitView
            fitViewOptions={FIT}
          >
            <Background gap={18} />
            <ZoomControls />
            <FitOnGrow count={design.nodes.length} />
          </ReactFlow>
        </div>
        {mode.kind === "match" ? (
          <div
            role="group"
            className="hidden gap-1 text-[13px] font-semibold lg:order-3 lg:flex"
            aria-label="How the match is scored"
          >
            <span className="flex-[60] rounded-[10px] bg-(--distributed-systems-tint) px-3 py-2 text-(--distributed-systems-line)">
              Simulation 60
            </span>
            <span className="flex-[25] rounded-[10px] bg-(--review-tint) px-3 py-2 text-(--review-line)">
              AI rubric 25
            </span>
            <span className="flex-[15] rounded-[10px] bg-[color-mix(in_srgb,var(--wrong)_12%,var(--page))] px-3 py-2 text-wrong">
              Speed 15
            </span>
          </div>
        ) : null}
        <p className="text-sm text-ink-muted lg:order-4" role="status">
          {
            {
              saved: "Saved.",
              waiting: "Changes not saved yet…",
              saving: "Saving…",
              stale:
                "This design was saved in another tab. Reload to carry on from there.",
              closed:
                "Submitted, or the time is up: changes here are no longer saved.",
              failed:
                "Couldn't save. Your changes are kept here; the next change tries again.",
            }[save]
          }
          {issues.length > 0 ? " Fix the problems below to save." : ""}
        </p>
        {issues.length > 0 ? (
          <ul className="list-disc pl-5 text-sm lg:order-5 lg:text-wrong">
            {issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <aside className="flex flex-col gap-4 lg:col-start-3 lg:row-span-2 lg:row-start-2 lg:min-w-0 lg:border-l lg:border-hairline lg:p-5">
        {node === undefined && edge === undefined ? (
          <p className="hidden text-[13px] text-ink-muted lg:block">
            Select a component or a connection to set it up.
          </p>
        ) : null}
        {node !== undefined ? (
          <section className="flex flex-col gap-2 rounded-3xl border border-hairline bg-card p-5 lg:gap-0 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0">
            <p className="hidden text-[13px] text-ink-muted lg:block">
              Selected
            </p>
            <h2 className="text-title lg:mb-2 lg:text-[19px]">
              {node.id} · {label(node.kind)}
            </h2>
            {configFields(node.kind).map((f) => {
              const value = (node.config as Record<string, number | string>)[
                f.name
              ];
              return (
                <label
                  key={f.name}
                  className="flex flex-col gap-1 text-sm lg:flex-row lg:items-center lg:justify-between lg:gap-3 lg:border-b lg:border-hairline lg:py-2 lg:text-ink-muted"
                >
                  {f.label}
                  {f.type === "int" ? (
                    <input
                      type="number"
                      min={f.min}
                      max={f.max}
                      value={value}
                      className="rounded-lg border-[1.5px] border-hairline-strong bg-page px-2 py-1 lg:w-24 lg:rounded-lg lg:border-[1.5px] lg:bg-page lg:text-right lg:font-semibold lg:text-ink lg:border-hairline-strong"
                      onChange={(e) => {
                        const n = Math.round(Number(e.target.value));
                        if (!Number.isFinite(n)) return;
                        setDesign((d) =>
                          updateNode(d, node.id, {
                            config: {
                              [f.name]: Math.min(f.max, Math.max(f.min, n)),
                            },
                          }),
                        );
                      }}
                    />
                  ) : (
                    <select
                      value={value}
                      className="rounded-lg border-[1.5px] border-hairline-strong bg-page px-2 py-1 lg:rounded-lg lg:border-[1.5px] lg:bg-page lg:font-semibold lg:text-ink lg:border-hairline-strong"
                      onChange={(e) => {
                        setDesign((d) =>
                          updateNode(d, node.id, {
                            config: { [f.name]: e.target.value },
                          }),
                        );
                      }}
                    >
                      {f.options.map((o) => (
                        <option key={o} value={o}>
                          {label(o)}
                        </option>
                      ))}
                    </select>
                  )}
                </label>
              );
            })}
            <label className="flex flex-col gap-1 text-sm lg:mt-3 lg:gap-1.5 lg:font-semibold">
              Why this choice
              <textarea
                value={node.note}
                maxLength={NOTE_MAX}
                rows={3}
                className="rounded-[14px] border-[1.5px] border-hairline-strong bg-page px-3 py-2 lg:rounded-[14px] lg:border-[1.5px] lg:bg-page lg:px-3 lg:py-2.5 lg:font-normal lg:leading-normal lg:border-hairline-strong"
                onChange={(e) => {
                  setDesign((d) =>
                    updateNode(d, node.id, { note: e.target.value }),
                  );
                }}
              />
              <span className="text-xs text-ink-muted lg:font-normal">
                {node.note.length}/{NOTE_MAX}
              </span>
            </label>
          </section>
        ) : null}

        {edge !== undefined ? (
          <fieldset className="flex flex-col gap-1 rounded-3xl border border-hairline bg-card p-5 text-sm lg:gap-0 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0">
            <legend className="px-1 lg:mb-2 lg:px-0 lg:text-[19px] lg:font-bold lg:tracking-[-0.01em]">
              {edge.from} → {edge.to} carries
            </legend>
            {problem.traffic.requests.map((r) => (
              <label
                key={r.type}
                className="flex items-center gap-2 lg:border-b lg:border-hairline lg:py-2.5"
              >
                <input
                  type="checkbox"
                  checked={edge.routes.includes(r.type)}
                  className="lg:size-4 lg:accent-(--select)"
                  onChange={(e) => {
                    const routes = e.target.checked
                      ? [...edge.routes, r.type]
                      : edge.routes.filter((t) => t !== r.type);
                    setDesign((d) => setRoutes(d, edge.from, edge.to, routes));
                    if (routes.length === 0) setSelected(null);
                  }}
                />
                {r.type} ({r.kind}, {r.rps.toLocaleString("en-US")}/s)
              </label>
            ))}
          </fieldset>
        ) : null}

        {mode.kind === "practice" ? (
          <Feedback
            ask={{ slug: problem.slug, design, ready: issues.length === 0 }}
            initial={mode.feedback}
          />
        ) : (
          <MatchPanel
            matchId={mode.matchId}
            deadline={mode.deadline}
            submitted={mode.submitted}
            design={design}
            ready={issues.length === 0}
          />
        )}
      </aside>

      <section
        className="flex flex-col gap-2 rounded-3xl border border-hairline bg-card p-5 lg:col-start-1 lg:row-start-3 lg:gap-1 lg:rounded-none lg:border-0 lg:bg-transparent lg:border-r lg:border-hairline lg:px-5 lg:pt-[18px] lg:pb-5"
        aria-live="polite"
      >
        <h2 className="text-title lg:mb-1 lg:text-[15px] lg:font-semibold lg:tracking-normal">
          <span className="lg:hidden">Preview</span>
          <span className="hidden lg:inline">Simulation scenarios</span>
        </h2>
        {result === null ? (
          <>
            <p className="text-sm text-ink-muted lg:text-[13px]">
              The preview runs once the design is valid.
            </p>
            <ul className="hidden flex-col text-sm text-ink-muted lg:flex">
              {problem.scenarios.map((s) => (
                <li key={s.id} className={SCENARIO_ROW}>
                  {s.name}
                  <ScenarioIcon state="not-run" />
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <p className="lg:text-[13px] lg:font-semibold">
              {result.points} of 60 simulation points ·{" "}
              {result.baselinePassed
                ? "baseline passed"
                : "baseline not passed"}
            </p>
            <p className="text-sm text-ink-muted lg:text-[13px]">
              ${Math.round(result.costPerMonth).toLocaleString("en-US")} a month
              of ${problem.budgetPerMonth.toLocaleString("en-US")}
            </p>
            <ul className="flex flex-col gap-1 text-sm lg:gap-0">
              {result.scenarios.map((s) => (
                <li key={s.id} className={SCENARIO_ROW}>
                  <span>
                    <span className="lg:hidden">
                      {s.targetsMet ? "✓" : "✗"}{" "}
                    </span>
                    {s.name}
                    <span className="lg:hidden">: </span>
                    <span className="lg:block lg:text-xs lg:text-ink-muted">
                      {Math.round(s.score * 100)}% · p99{" "}
                      {s.p99Ms === null ? "unbounded" : `${String(s.p99Ms)} ms`}{" "}
                      · {(s.availability * 100).toFixed(2)}% served
                    </span>
                  </span>
                  <ScenarioIcon
                    state={
                      s.targetsMet
                        ? "passed"
                        : s.score > 0
                          ? "partly"
                          : "failed"
                    }
                  />
                </li>
              ))}
            </ul>
            {advice.length > 0 ? (
              <>
                <h3 className="font-sans text-sm lg:mt-3 lg:font-semibold">
                  Hints
                </h3>
                <ul className="list-disc pl-5 text-sm lg:flex lg:list-none lg:flex-col lg:gap-1.5 lg:pl-0">
                  {advice.map((h) => (
                    <li
                      key={h}
                      className="lg:rounded-xl lg:bg-(--system-design-tint) lg:px-3 lg:py-2.5 lg:text-[13px] lg:leading-snug lg:font-medium lg:text-(--system-design-line)"
                    >
                      {h}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </>
        )}
      </section>
    </>
  );
}

const SCENARIO_ROW =
  "lg:flex lg:items-start lg:justify-between lg:gap-2 lg:border-b lg:border-hairline lg:py-[9px] lg:last:border-b-0";

// The design's scenario marks: passed, partly met, failed, not run yet.
function ScenarioIcon({
  state,
}: {
  state: "passed" | "partly" | "failed" | "not-run";
}) {
  const shared = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    role: "img",
    className: "mt-px hidden shrink-0 lg:block",
  };
  if (state === "passed")
    return (
      <svg {...shared} aria-label="Passed" color="var(--go)">
        <circle cx="12" cy="12" r="9" />
        <path d="m8 12 3 3 5-6" />
      </svg>
    );
  if (state === "partly")
    return (
      <svg
        {...shared}
        aria-label="Partly met"
        color="var(--system-design-line)"
      >
        <path d="M12 3 2 20h20zM12 9v5M12 17h.01" />
      </svg>
    );
  if (state === "failed")
    return (
      <svg {...shared} aria-label="Failed" color="var(--wrong)">
        <circle cx="12" cy="12" r="9" />
        <path d="m9 9 6 6M15 9l-6 6" />
      </svg>
    );
  return (
    <svg {...shared} aria-label="Not run yet">
      <circle cx="12" cy="12" r="9" strokeDasharray="3 3" />
    </svg>
  );
}
