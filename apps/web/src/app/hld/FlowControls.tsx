"use client";

import { ControlButton, Controls, useReactFlow } from "@xyflow/react";
import { useEffect, useRef } from "react";

// The web design's canvas framing ("HLD battle, web"): the whole graph in view with room
// around it, never blown up past its own size, as it loads and as components are added.
export const FIT = { padding: 0.12, maxZoom: 1 };

// Inside a ReactFlow: fits the view again whenever the graph gains a node. Once React
// Flow has measured it, so the new node is counted.
export function FitOnGrow({ count }: { count: number }) {
  const { fitView } = useReactFlow();
  const seen = useRef(count);
  useEffect(() => {
    const grew = count > seen.current;
    seen.current = count;
    if (!grew) return;
    const frame = requestAnimationFrame(() => {
      void fitView({ ...FIT, duration: 200 });
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [count, fitView]);
  return null;
}

// The design's zoom: two square buttons, − then +, at the canvas's bottom left. React
// Flow's own buttons, so their names and keyboard use stay.
export function ZoomControls() {
  const { zoomIn, zoomOut } = useReactFlow();
  const button =
    "size-8! rounded-[10px]! border-[1.5px]! border-hairline-strong! bg-page! text-ink! hover:bg-well!";
  return (
    <Controls
      orientation="horizontal"
      showZoom={false}
      showFitView={false}
      showInteractive={false}
      className="m-3.5! flex gap-2 shadow-none!"
    >
      <ControlButton
        aria-label="Zoom out"
        title="Zoom out"
        className={button}
        onClick={() => {
          void zoomOut();
        }}
      >
        <Glyph d="M5 12h14" />
      </ControlButton>
      <ControlButton
        aria-label="Zoom in"
        title="Zoom in"
        className={button}
        onClick={() => {
          void zoomIn();
        }}
      >
        <Glyph d="M12 5v14M5 12h14" />
      </ControlButton>
    </Controls>
  );
}

function Glyph({ d }: { d: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-4! max-h-none! max-w-none! fill-none!"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
    >
      <path d={d} />
    </svg>
  );
}
