"use client";

import { Design, type HldProblem, simulate } from "@interval/hld";
import { Background, type Edge, type Node, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import { flowTheme, NodeLabel } from "./flow";

// P6-W44 (Q-P6-08): a design shown, not edited: for spectators and replays. Its
// simulation runs here, as the canvas's preview does (CANVAS-5).
export function DesignView({
  problem,
  design: raw,
  title,
}: {
  problem: HldProblem;
  design: unknown;
  title: string;
}) {
  const parsed = Design.safeParse(raw);
  const design = parsed.success ? parsed.data : null;
  const result = useMemo(
    () => (design === null ? null : simulate(problem, design)),
    [problem, design],
  );
  if (design === null)
    return (
      <section className="rounded-md border border-line p-3">
        <h2 className="text-title">{title}</h2>
        <p className="text-sm text-ink-muted">Nothing drawn yet.</p>
      </section>
    );
  const nodes: Node[] = design.nodes.map((n) => ({
    id: n.id,
    position: n.position ?? { x: 0, y: 0 },
    data: { label: <NodeLabel id={n.id} kind={n.kind} /> },
  }));
  const edges: Edge[] = design.edges.map((e) => ({
    id: `${e.from}->${e.to}`,
    source: e.from,
    target: e.to,
    label: e.routes.join(", "),
  }));
  return (
    <section className="flex flex-col gap-2 rounded-md border border-line p-3">
      <h2 className="text-title">{title}</h2>
      <div
        className="h-80 overflow-hidden rounded-md border border-line lg:rounded-[20px] lg:border-hairline"
        style={flowTheme}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          fitView
        >
          <Background gap={18} />
        </ReactFlow>
      </div>
      {result === null || result.scenarios.length === 0 ? null : (
        <p className="text-sm">
          Preview: {result.points} of 60 simulation points ·{" "}
          {result.baselinePassed ? "baseline passed" : "baseline not passed"}
        </p>
      )}
      <ul className="text-xs text-ink-muted">
        {design.nodes
          .filter((n) => n.note !== "")
          .map((n) => (
            <li key={n.id}>
              <span className="font-semibold">{n.id}:</span> {n.note}
            </li>
          ))}
      </ul>
    </section>
  );
}
