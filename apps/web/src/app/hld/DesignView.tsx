"use client";

import { Design, type HldProblem, simulate } from "@interval/hld";
import { Background, type Edge, type Node, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import { FIT, ZoomControls } from "./FlowControls";
import { flowTheme, NODE_STYLE, NodeLabel } from "./flow";

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
      <section className={PANEL}>
        <h2 className={HEADING}>{title}</h2>
        <p className="text-sm text-ink-muted">Nothing drawn yet.</p>
      </section>
    );
  const nodes: Node[] = design.nodes.map((n) => ({
    id: n.id,
    position: n.position ?? { x: 0, y: 0 },
    data: { label: <NodeLabel id={n.id} kind={n.kind} /> },
    style: NODE_STYLE,
  }));
  const edges: Edge[] = design.edges.map((e) => ({
    id: `${e.from}->${e.to}`,
    source: e.from,
    target: e.to,
    label: e.routes.join(", "),
  }));
  return (
    <section className={PANEL}>
      <h2 className={HEADING}>{title}</h2>
      <div
        className="h-80 overflow-hidden rounded-[20px] border border-hairline lg:h-[420px]"
        style={flowTheme}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          fitView
          fitViewOptions={FIT}
        >
          <Background gap={18} />
          <ZoomControls />
        </ReactFlow>
      </div>
      {result === null || result.scenarios.length === 0 ? null : (
        <p className="text-[13px] font-semibold">
          Preview: {result.points} of 60 simulation points ·{" "}
          {result.baselinePassed ? "baseline passed" : "baseline not passed"}
        </p>
      )}
      <ul className="flex flex-col gap-1 text-[13px] text-ink-muted">
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

// Each side's design in the battle design's card: the frame's hairline and radius.
const PANEL =
  "flex flex-col gap-2 rounded-3xl border border-hairline bg-card p-5 lg:rounded-[22px] lg:p-[18px]";
const HEADING = "text-section";
