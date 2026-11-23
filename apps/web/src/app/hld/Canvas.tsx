"use client";

import {
  addComponent,
  check,
  COMPONENT_NAMES,
  componentNames,
  coverage,
  fitsProblem,
  type ComponentKind,
  configFields,
  connect,
  type Design,
  type DesignNode,
  type HldProblem,
  hints,
  NOTE_MAX,
  removeNode,
  type ScenarioResult,
  setRoutes,
  simulate,
  type SimulationResult,
  starterDesign,
  updateNode,
} from "@interval/hld";
import {
  Background,
  ConnectionMode,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  Position,
  ReactFlow,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  type ReactNode,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Feedback } from "./Feedback";
import { FIT, FitOnGrow, ZoomControls } from "./FlowControls";
import { HEADER, Requirements } from "./Frame";
import {
  EDIT_FLOW,
  flowTheme,
  NODE_STYLE,
  NodeLabel,
  nodeRole,
  SELECTED_NODE,
} from "./flow";
import { MatchPanel } from "./MatchPanel";
import { freeSpot } from "./placement";
import type { FeedbackView } from "./practice/feedback";
import { saveDesign } from "./practice/[slug]/actions";

// P6-W39 (CANVAS-1, CANVAS-2, CANVAS-5; Q-P6-03): the HLD canvas. The design is the one
// state; React Flow draws it, and every edit goes through packages/hld's pure functions.
// The preview simulation runs here, in the browser, on every valid draft, with hints by
// rule; the design autosaves about 2 s after the last change.

const SAVE_AFTER_MS = 2_000;
// What the palette's drag carries: the kind of component dropped on the canvas.
const KIND_MIME = "application/x-interval-hld-kind";
// A dropped card is centred on the pointer (NODE_STYLE's width, about its height).
const DROP_OFFSET = { x: 62, y: 36 };
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
// A request type or a setting's option as a word: "multi_zone" → "Multi zone".
const words = (s: string) => capital(s.replaceAll("_", " "));
const OPTION_NAMES: Record<string, string> = {
  none: "None",
  standby: "Standby, same zone",
  multi_zone: "Standby, other zone",
};

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
  header,
}: {
  problem: HldProblem;
  initial: Design;
  version: number;
  mode: CanvasMode;
  // The page's header row; practice adds its Start over to it.
  header: ReactNode;
}) {
  const [design, setDesign] = useState(initial);
  const [selected, setSelected] = useState<Selection>(null);
  // React Flow measures each node once drawn; a controlled node must carry it back.
  const [sizes, setSizes] = useState<
    Record<string, { width: number; height: number }>
  >({});
  const [save, setSave] = useState<SaveState>("saved");
  const flow = useRef<ReactFlowInstance | null>(null);
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
  // Q-WD-15: what the design covers so far; nothing while it can't be simulated.
  const covered = useMemo(
    () =>
      result === null
        ? {
            covered: 0,
            total: problem.requirements.length,
            items: problem.requirements.map((text) => ({
              text,
              covered: false,
              by: null,
            })),
          }
        : coverage(problem, previewed, result),
    [problem, previewed, result],
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

  const retry = () => {
    refusedJson.current = null;
    setSettled((n) => n + 1);
  };

  const names = useMemo(() => componentNames(design.nodes), [design.nodes]);
  const nameOf = (id: string) => names.get(id) ?? id;
  const allTypes = problem.traffic.requests.length;
  const edgeId = (e: { from: string; to: string }) => `${e.from}->${e.to}`;
  const nodes: Node[] = design.nodes.map((n) => {
    const size = sizes[n.id];
    const chosen =
      selected !== null && "node" in selected && selected.node === n.id;
    return {
      id: n.id,
      position: n.position ?? { x: 0, y: 0 },
      data: {
        label: (
          <NodeLabel kind={n.kind} name={nameOf(n.id)} role={nodeRole(n)} />
        ),
      },
      ariaLabel: `${nameOf(n.id)}, ${nodeRole(n)}`,
      style: NODE_STYLE,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
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
    type: "smoothstep",
    interactionWidth: 24,
    ariaLabel: `${nameOf(e.from)} to ${nameOf(e.to)}`,
    // Every request type is the default; only a narrowed connection says what it carries.
    ...(e.routes.length < allTypes
      ? { label: e.routes.map((t) => t.replaceAll("_", " ")).join(", ") }
      : {}),
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

  // A drag between handles and the Selected panel's "Connect to…" both land here.
  const link = (from: string, to: string) => {
    setDesign((d) => connect(d, problem, from, to));
  };
  const startOver = () => {
    if (!window.confirm("Start over? Your design is cleared.")) return;
    setDesign(starterDesign());
    setSelected(null);
  };

  const kinds = problem.allowedComponents.filter(
    (k): k is Exclude<ComponentKind, "client"> => k !== "client",
  );
  const add = (
    kind: Exclude<ComponentKind, "client">,
    position: { x: number; y: number },
  ) => {
    const d = addComponent(design, kind, position);
    setDesign(d);
    const added = d.nodes.at(-1);
    if (added !== undefined) setSelected({ node: added.id });
  };
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
  const risk =
    node === undefined || result === null
      ? NO_RISK
      : risksOf(problem, result, node);

  // The parts go into the page's frame (Frame.tsx): the canvas in the middle, the
  // selection and the submission on the right, the simulation under the requirements.
  return (
    <>
      <header className={HEADER}>
        {header}
        {mode.kind === "practice" ? (
          <button
            type="button"
            onClick={startOver}
            className="self-start rounded-full border-[1.5px] border-hairline-strong px-4 py-1.5 text-sm font-semibold text-ink hover:bg-well focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-select lg:h-[38px] lg:self-auto"
          >
            Start over
          </button>
        ) : null}
      </header>
      <Requirements coverage={covered} />
      <section className="flex flex-col gap-2 lg:col-start-2 lg:row-span-2 lg:row-start-2 lg:min-h-0 lg:min-w-0 lg:gap-3 lg:overflow-y-auto lg:p-5">
        <div
          className="flex flex-wrap gap-2 lg:order-2 lg:items-center lg:gap-1.5"
          role="toolbar"
          aria-label="Add a component"
        >
          <span className="mr-1 hidden text-[13px] text-ink-muted lg:inline">
            Drag in
          </span>
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              draggable
              aria-label={`Add ${COMPONENT_NAMES[k]}`}
              title="Click to add, or drag onto the canvas"
              className="cursor-grab rounded-full bg-well px-3 py-1.5 text-sm font-medium hover:bg-track focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-select active:cursor-grabbing lg:h-8 lg:px-3 lg:py-0 lg:text-[13px]"
              onDragStart={(e) => {
                e.dataTransfer.setData(KIND_MIME, k);
                e.dataTransfer.effectAllowed = "copy";
              }}
              onClick={() => {
                add(k, freeSpot(design.nodes));
              }}
            >
              <span className="lg:hidden">+ </span>
              {COMPONENT_NAMES[k]}
            </button>
          ))}
        </div>
        <div
          className={`relative h-[60vh] min-h-96 shrink-0 overflow-hidden rounded-[20px] border border-hairline lg:order-1 lg:h-auto lg:min-h-[420px] lg:flex-1 ${EDIT_FLOW}`}
          style={flowTheme}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes(KIND_MIME)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }}
          onDrop={(e) => {
            const kind = kinds.find(
              (k) => k === e.dataTransfer.getData(KIND_MIME),
            );
            if (kind === undefined || flow.current === null) return;
            e.preventDefault();
            const at = flow.current.screenToFlowPosition({
              x: e.clientX,
              y: e.clientY,
            });
            add(kind, {
              x: Math.round(at.x - DROP_OFFSET.x),
              y: Math.round(at.y - DROP_OFFSET.y),
            });
          }}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onInit={(instance) => {
              flow.current = instance;
            }}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={(c) => {
              link(c.source, c.target);
            }}
            connectionMode={ConnectionMode.Loose}
            connectionLineStyle={{ stroke: "var(--select)", strokeWidth: 3 }}
            deleteKeyCode={["Backspace", "Delete"]}
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
          {design.edges.length === 0 ? (
            <p className="pointer-events-none absolute top-3 left-3 z-10 max-w-[calc(100%-9rem)] rounded-xl border border-hairline bg-card px-3 py-2 text-[13px] leading-snug text-ink-muted">
              {design.nodes.length <= 1
                ? "Add a component from the list below: click it, or drag it onto the canvas."
                : "Drag from a component's edge dot to another component to connect them."}
            </p>
          ) : null}
          <SavePill save={save} blocked={issues.length > 0} onRetry={retry} />
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
        {save === "stale" || save === "closed" ? (
          <p className="text-sm text-ink-muted lg:order-4">
            {save === "stale"
              ? "This design was saved in another tab. Reload to carry on from there."
              : "Submitted, or the time is up: changes here are no longer saved."}
          </p>
        ) : null}
        {issues.length > 0 ? (
          <div className="text-sm lg:order-5">
            <p className="font-semibold">Fix these to save the design:</p>
            <ul className="list-disc pl-5 lg:text-wrong">
              {issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <aside className="flex flex-col gap-4 lg:col-start-3 lg:row-span-2 lg:row-start-2 lg:min-h-0 lg:min-w-0 lg:gap-0 lg:border-l lg:border-hairline">
        {/* The selection scrolls; the feedback or the submission stays at the foot. */}
        <div className="flex flex-col gap-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:p-5 lg:[scrollbar-gutter:stable]">
          {node === undefined && edge === undefined ? (
            <div className="hidden flex-col items-start gap-1.5 rounded-[14px] border-[1.5px] border-dashed border-hairline-strong p-4 lg:flex">
              <p className="text-[13px] text-ink-muted">Selected</p>
              <p className="text-[15px] font-semibold">Nothing yet</p>
              <p className="text-[13px] leading-snug text-ink-muted">
                Pick a component or a connection on the canvas to set it up and
                say why you chose it.
              </p>
            </div>
          ) : null}
          {node !== undefined ? (
            <section
              aria-label="Selected component"
              className="flex flex-col gap-2 rounded-3xl border border-hairline bg-card p-5 lg:gap-0 lg:rounded-[14px] lg:border-[1.5px] lg:bg-transparent lg:p-4"
            >
              <p className="hidden text-[13px] text-ink-muted lg:block">
                Selected
              </p>
              <h2 className="text-title lg:mb-2 lg:text-[19px] lg:leading-snug lg:font-bold lg:tracking-[-0.01em]">
                {nameOf(node.id)} · {nodeRole(node)}
              </h2>
              {configFields(node.kind).map((f) => {
                const value = (node.config as Record<string, number | string>)[
                  f.name
                ];
                const risky = risk.fields.has(f.name);
                return (
                  <label
                    key={f.name}
                    className="flex flex-col gap-1 text-sm lg:min-h-11 lg:flex-row lg:items-center lg:justify-between lg:gap-3 lg:border-b lg:border-hairline lg:py-1.5 lg:text-ink-soft"
                  >
                    {f.label}
                    <span
                      className={`flex items-center gap-1.5 ${risky ? "text-(--system-design-line)" : ""}`}
                    >
                      {risky ? <WarnIcon label="At risk" /> : null}
                      {f.type === "int" ? (
                        <input
                          type="number"
                          min={f.min}
                          max={f.max}
                          value={value}
                          aria-invalid={risky || undefined}
                          className={`${FIELD} w-full lg:w-20 lg:text-right`}
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
                          aria-invalid={risky || undefined}
                          className={`${FIELD} w-full lg:w-34`}
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
                              {OPTION_NAMES[o] ?? words(o)}
                            </option>
                          ))}
                        </select>
                      )}
                    </span>
                  </label>
                );
              })}
              {risk.said.length > 0 ? (
                <ul className="mt-3 flex flex-col gap-1 rounded-xl bg-(--system-design-tint) px-3 py-2.5 text-[13px] leading-snug font-medium text-(--system-design-line)">
                  {risk.said.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              ) : null}
              <label className="mt-3 flex flex-col gap-1.5 text-sm">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">Why this choice</span>
                  <span className="text-xs text-ink-muted tabular-nums">
                    {node.note.length}/{NOTE_MAX}
                  </span>
                </span>
                <textarea
                  value={node.note}
                  maxLength={NOTE_MAX}
                  rows={3}
                  placeholder="What it's for and the trade-off you made"
                  className="resize-none rounded-[14px] border-[1.5px] border-hairline-strong bg-page px-3 py-2.5 leading-normal placeholder:text-ink-muted focus-visible:border-select focus-visible:outline-none"
                  onChange={(e) => {
                    setDesign((d) =>
                      updateNode(d, node.id, { note: e.target.value }),
                    );
                  }}
                />
              </label>
              <ConnectTo
                options={design.nodes
                  .filter(
                    (n) =>
                      n.id !== node.id &&
                      !design.edges.some(
                        (e) => e.from === node.id && e.to === n.id,
                      ),
                  )
                  .map((n) => ({ id: n.id, name: nameOf(n.id) }))}
                onPick={(to) => {
                  link(node.id, to);
                }}
              />
              {node.kind === "client" ? null : (
                <RemoveButton
                  label="Remove component"
                  onClick={() => {
                    setDesign((d) => removeNode(d, node.id));
                    setSelected(null);
                  }}
                />
              )}
            </section>
          ) : null}

          {edge !== undefined ? (
            <fieldset className="flex flex-col gap-1 rounded-3xl border border-hairline bg-card p-5 text-sm lg:gap-0 lg:rounded-[14px] lg:border-[1.5px] lg:bg-transparent lg:p-4">
              <p className="hidden text-[13px] text-ink-muted lg:block">
                Selected connection
              </p>
              <legend className="sr-only">
                {nameOf(edge.from)} to {nameOf(edge.to)}: what it carries
              </legend>
              <h2
                aria-hidden="true"
                className="px-1 lg:mb-2 lg:px-0 lg:text-[19px] lg:leading-snug lg:font-bold lg:tracking-[-0.01em]"
              >
                {nameOf(edge.from)} → {nameOf(edge.to)}
              </h2>
              <p className="text-[13px] text-ink-muted lg:mb-1">Carries</p>
              {problem.traffic.requests.map((r) => (
                <label
                  key={r.type}
                  className="flex items-center justify-between gap-2 py-1 lg:min-h-11 lg:border-b lg:border-hairline lg:py-1.5"
                >
                  <span className="flex flex-col">
                    <span className="font-medium">
                      {words(r.type)} requests
                    </span>
                    <span className="text-xs text-ink-muted">
                      {r.kind === "write" ? "Writes" : "Reads"},{" "}
                      {r.rps.toLocaleString("en-US")} a second
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={edge.routes.includes(r.type)}
                    className="size-4 accent-(--select)"
                    onChange={(e) => {
                      const routes = e.target.checked
                        ? [...edge.routes, r.type]
                        : edge.routes.filter((t) => t !== r.type);
                      setDesign((d) =>
                        setRoutes(d, edge.from, edge.to, routes),
                      );
                      if (routes.length === 0) setSelected(null);
                    }}
                  />
                </label>
              ))}
              <RemoveButton
                label="Remove connection"
                onClick={() => {
                  setDesign((d) => setRoutes(d, edge.from, edge.to, []));
                  setSelected(null);
                }}
              />
            </fieldset>
          ) : null}
        </div>
        <div className="flex flex-col lg:max-h-[60%] lg:shrink-0 lg:overflow-y-auto lg:border-t lg:border-hairline lg:px-5 lg:pb-5">
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
        </div>
      </aside>

      <section
        className="flex flex-col gap-2 rounded-3xl border border-hairline bg-card p-5 lg:col-start-1 lg:row-start-3 lg:min-h-0 lg:gap-1 lg:overflow-y-auto lg:rounded-none lg:border-0 lg:bg-transparent lg:border-r lg:border-hairline lg:px-5 lg:pt-[18px] lg:pb-5"
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
              {result.scenarios.map((s) => {
                const state = s.targetsMet
                  ? "passed"
                  : s.score > 0
                    ? "partly"
                    : "failed";
                const target = problem.scenarios.find(
                  (x) => x.id === s.id,
                )?.targets;
                return (
                  <li
                    key={s.id}
                    className={SCENARIO_ROW}
                    title={scenarioDetail(s, target)}
                  >
                    <span className="min-w-0">
                      <span className="lg:hidden">
                        {s.targetsMet ? "✓" : "✗"}{" "}
                      </span>
                      {s.name}
                      <span className="sr-only">
                        . {scenarioDetail(s, target)}
                      </span>
                      <span
                        aria-hidden="true"
                        className="block text-xs text-ink-muted"
                      >
                        {scenarioLine(s, target)}
                      </span>
                    </span>
                    <ScenarioIcon state={state} />
                  </li>
                );
              })}
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

const FIELD =
  "h-9 rounded-[10px] border-[1.5px] border-hairline-strong bg-page px-2.5 font-semibold text-ink focus-visible:border-select focus-visible:outline-none aria-invalid:border-(--system-design-line)";

// "98%", "99.95%", "100%": whole percents, but the last nines when they matter.
function percent(share: number): string {
  const x = share * 100;
  return `${String(Number(x.toFixed(x >= 99 ? 2 : 0)))}%`;
}

type Targets = { p99Ms: number; availability: number } | undefined;

// The scenario in one plain line: how much it serves, how fast, against its target.
export function scenarioLine(s: ScenarioResult, target: Targets): string {
  if (s.availability === 0) return "Serves nothing yet";
  const p99 =
    s.p99Ms === null
      ? "requests back up"
      : `p99 ${String(Math.round(s.p99Ms))} ms`;
  return `Serves ${percent(s.availability)} · ${p99}${
    target === undefined ? "" : ` (target ${String(target.p99Ms)} ms)`
  }`;
}

// The full numbers, for the row's tooltip and screen readers.
function scenarioDetail(s: ScenarioResult, target: Targets): string {
  const p99 =
    s.p99Ms === null ? "unbounded" : `${String(Math.round(s.p99Ms))} ms`;
  return [
    `Score ${String(Math.round(s.score * 100))}% of its weight`,
    `${(s.availability * 100).toFixed(2)}% served${target === undefined ? "" : ` (target ${(target.availability * 100).toFixed(2)}%)`}`,
    `p99 ${p99}${target === undefined ? "" : ` (target ${String(target.p99Ms)} ms)`}`,
  ].join(" · ");
}

type Risk = { fields: ReadonlySet<string>; said: string[] };
const NO_RISK: Risk = { fields: new Set(), said: [] };

// The hints' rules for the one selected component (hints.ts): where it goes down with
// nothing to take over, or can't keep up, and which of its settings that points at.
export function risksOf(
  problem: HldProblem,
  result: SimulationResult,
  node: DesignNode,
): Risk {
  const config = node.config as Record<string, number | string>;
  const fields = new Set<string>();
  const said: string[] = [];
  for (const s of result.scenarios) {
    const at = s.nodes.find((n) => n.id === node.id);
    if (at === undefined) continue;
    const scope = problem.scenarios.find((x) => x.id === s.id)?.failure?.scope;
    if (!at.up) {
      said.push(`Goes down in "${s.name}" with nothing to take over.`);
      if ("failover" in config && config.failover !== "multi_zone")
        fields.add("failover");
      if (scope === "zone" && config.zones === 1) fields.add("zones");
      if (scope === "region" && config.regions === 1) fields.add("regions");
      if (scope === "node" && config.nodes === 1) fields.add("nodes");
    } else if (at.utilization !== null && at.utilization >= 1) {
      said.push(`Can't keep up in "${s.name}": give it more capacity.`);
      for (const f of ["nodes", "readReplicas", "partitions", "shards"])
        if (f in config) fields.add(f);
    } else if (at.utilization !== null && at.utilization > 0.8)
      said.push(`Runs hot in "${s.name}": past 80% busy, waits grow fast.`);
  }
  return { fields, said: [...new Set(said)].slice(0, 3) };
}

// The design's save state, as a small pill in the canvas's corner.
function SavePill({
  save,
  blocked,
  onRetry,
}: {
  save: SaveState;
  blocked: boolean;
  onRetry: () => void;
}) {
  const shown =
    blocked && save !== "saved" && save !== "stale" && save !== "closed"
      ? "blocked"
      : save;
  const text = {
    saved: "Saved",
    waiting: "Saving…",
    saving: "Saving…",
    blocked: "Not saved",
    failed: "Not saved",
    stale: "Saved in another tab",
    closed: "No longer saving",
  }[shown];
  const why = {
    saved: "Your design is saved.",
    waiting: "Your changes are saved a moment after you stop editing.",
    saving: "Saving your changes.",
    blocked:
      "The design can't be saved until the problems under the canvas are fixed.",
    failed: "Couldn't save. Your changes are kept here.",
    stale:
      "This design was saved in another tab. Reload to carry on from there.",
    closed: "Submitted, or the time is up: changes here are no longer saved.",
  }[shown];
  const tone =
    shown === "saved"
      ? "text-go-text"
      : shown === "failed" || shown === "blocked" || shown === "stale"
        ? "text-wrong"
        : "text-ink-muted";
  return (
    <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
      <p
        role="status"
        title={why}
        className={`flex h-7 items-center gap-1 rounded-full border border-hairline bg-card px-2.5 text-xs font-semibold ${tone}`}
      >
        {shown === "saved" ? (
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m5 12.5 4.5 4.5L19 7.5" />
          </svg>
        ) : null}
        {text}
        <span className="sr-only">. {why}</span>
      </p>
      {shown === "failed" ? (
        <button
          type="button"
          onClick={onRetry}
          className="h-7 rounded-full bg-ink px-3 text-xs font-semibold text-page focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-select"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}

// The keyboard's way to draw a connection: pick where the selected component sends to.
function ConnectTo({
  options,
  onPick,
}: {
  options: { id: string; name: string }[];
  onPick: (to: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <label className="mt-3 flex flex-col gap-1.5 text-sm">
      <span className="font-semibold">Connect to…</span>
      <select
        value=""
        className={`${FIELD} w-full`}
        onChange={(e) => {
          if (e.target.value !== "") onPick(e.target.value);
        }}
      >
        <option value="">Choose a component</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function RemoveButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Or select it on the canvas and press Delete"
      className="mt-3 flex items-center gap-1.5 self-start rounded-lg px-1 py-1 text-[13px] font-semibold text-wrong hover:underline focus-visible:outline-2 focus-visible:outline-select"
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
      </svg>
      {label}
    </button>
  );
}

function WarnIcon({ label }: { label: string }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={label}
      className="shrink-0"
    >
      <path d="M12 3 2 20h20zM12 9v5M12 17h.01" />
    </svg>
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
