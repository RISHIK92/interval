"use client";

import {
  addComponent,
  check,
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
  Controls,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  ReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { saveDesign } from "./actions";

// P6-W39 (CANVAS-1, CANVAS-2, CANVAS-5; Q-P6-03): the HLD canvas. The design is the one
// state; React Flow draws it, and every edit goes through packages/hld's pure functions.
// The preview simulation runs here, in the browser, on every valid draft, with hints by
// rule; the design autosaves about 2 s after the last change.

const SAVE_AFTER_MS = 2_000;
const label = (kind: string) => kind.replaceAll("_", " ");

type Selection = { node: string } | { from: string; to: string } | null;
type SaveState = "saved" | "saving" | "waiting" | "stale" | "failed";

export function Canvas({
  problem,
  initial,
  version: loadedVersion,
}: {
  problem: HldProblem;
  initial: Design;
  version: number;
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

  const issues = useMemo(() => check(design), [design]);
  // Dragging changes the design on every frame; the preview follows when React can.
  const previewed = useDeferredValue(design);
  const result = useMemo(
    () => (check(previewed).length === 0 ? simulate(problem, previewed) : null),
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
      saveDesign(problem.slug, design, version.current)
        .then((r) => {
          if (r.ok) {
            version.current = r.version;
            savedJson.current = json;
            setSave("saved");
          } else {
            stale.current = r.reason === "stale";
            refusedJson.current = json;
            console.error("HLD autosave refused", r.reason);
            setSave(stale.current ? "stale" : "failed");
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
  }, [design, issues, problem.slug, settled]);

  const edgeId = (e: { from: string; to: string }) => `${e.from}->${e.to}`;
  const nodes: Node[] = design.nodes.map((n) => {
    const size = sizes[n.id];
    return {
      id: n.id,
      position: n.position ?? { x: 0, y: 0 },
      data: { label: `${n.id} · ${label(n.kind)}` },
      deletable: n.kind !== "client",
      selected:
        selected !== null && "node" in selected && selected.node === n.id,
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

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-4 lg:grid-cols-[1fr_20rem]">
      <section className="flex flex-col gap-2">
        <div
          className="flex flex-wrap gap-2"
          role="toolbar"
          aria-label="Add a component"
        >
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              className="rounded-md border border-line px-2 py-1 text-sm"
              onClick={() => {
                const d = addComponent(design, k, {
                  x: 80 + 40 * (design.nodes.length % 8),
                  y: 60 * design.nodes.length,
                });
                setDesign(d);
                const added = d.nodes.at(-1);
                if (added !== undefined) setSelected({ node: added.id });
              }}
            >
              + {label(k)}
            </button>
          ))}
        </div>
        <div className="h-[60vh] min-h-96 rounded-md border border-line">
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
          >
            <Background />
            <Controls />
          </ReactFlow>
        </div>
        <p className="text-sm text-ink-muted" role="status">
          {
            {
              saved: "Saved.",
              waiting: "Changes not saved yet…",
              saving: "Saving…",
              stale:
                "This design was saved in another tab. Reload to carry on from there.",
              failed:
                "Couldn't save. Your changes are kept here; the next change tries again.",
            }[save]
          }
          {issues.length > 0 ? " Fix the problems below to save." : ""}
        </p>
        {issues.length > 0 ? (
          <ul className="list-disc pl-5 text-sm">
            {issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <aside className="flex flex-col gap-4">
        {node !== undefined ? (
          <section className="flex flex-col gap-2 rounded-md border border-line p-3">
            <h2 className="text-title">
              {node.id} · {label(node.kind)}
            </h2>
            {configFields(node.kind).map((f) => {
              const value = (node.config as Record<string, number | string>)[
                f.name
              ];
              return (
                <label key={f.name} className="flex flex-col gap-1 text-sm">
                  {f.name}
                  {f.type === "int" ? (
                    <input
                      type="number"
                      min={f.min}
                      max={f.max}
                      value={value}
                      className="rounded-md border border-line px-2 py-1"
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
                      className="rounded-md border border-line px-2 py-1"
                      onChange={(e) => {
                        setDesign((d) =>
                          updateNode(d, node.id, {
                            config: { [f.name]: e.target.value },
                          }),
                        );
                      }}
                    >
                      {f.options.map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  )}
                </label>
              );
            })}
            <label className="flex flex-col gap-1 text-sm">
              Why this choice
              <textarea
                value={node.note}
                maxLength={NOTE_MAX}
                rows={3}
                className="rounded-md border border-line px-2 py-1"
                onChange={(e) => {
                  setDesign((d) =>
                    updateNode(d, node.id, { note: e.target.value }),
                  );
                }}
              />
              <span className="text-xs text-ink-muted">
                {node.note.length}/{NOTE_MAX}
              </span>
            </label>
          </section>
        ) : null}

        {edge !== undefined ? (
          <fieldset className="flex flex-col gap-1 rounded-md border border-line p-3 text-sm">
            <legend className="px-1">
              {edge.from} → {edge.to} carries
            </legend>
            {problem.traffic.requests.map((r) => (
              <label key={r.type} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={edge.routes.includes(r.type)}
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

        <section
          className="flex flex-col gap-2 rounded-md border border-line p-3"
          aria-live="polite"
        >
          <h2 className="text-title">Preview</h2>
          {result === null ? (
            <p className="text-sm text-ink-muted">
              The preview runs once the design is valid.
            </p>
          ) : (
            <>
              <p>
                {result.points} of 60 simulation points ·{" "}
                {result.baselinePassed
                  ? "baseline passed"
                  : "baseline not passed"}
              </p>
              <p className="text-sm text-ink-muted">
                ${Math.round(result.costPerMonth).toLocaleString("en-US")} a
                month of ${problem.budgetPerMonth.toLocaleString("en-US")}
              </p>
              <ul className="flex flex-col gap-1 text-sm">
                {result.scenarios.map((s) => (
                  <li key={s.id}>
                    {s.targetsMet ? "✓" : "✗"} {s.name}:{" "}
                    {Math.round(s.score * 100)}% · p99{" "}
                    {s.p99Ms === null ? "unbounded" : `${String(s.p99Ms)} ms`} ·{" "}
                    {(s.availability * 100).toFixed(2)}% served
                  </li>
                ))}
              </ul>
              {advice.length > 0 ? (
                <>
                  <h3 className="font-sans text-sm">Hints</h3>
                  <ul className="list-disc pl-5 text-sm">
                    {advice.map((h) => (
                      <li key={h}>{h}</li>
                    ))}
                  </ul>
                </>
              ) : null}
            </>
          )}
        </section>
      </aside>
    </div>
  );
}
