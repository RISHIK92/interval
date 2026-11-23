import type { ComponentKind, DesignNode } from "@interval/hld";
import type { CSSProperties } from "react";

// The web design's canvas ("HLD battle, web"): React Flow drawn in the design system's
// tokens, so a node reads in light and dark alike, and each node shows its kind with
// the topic ramp's icon.

export const flowTheme = {
  "--xy-background-color": "var(--well)",
  "--xy-background-pattern-color": "var(--hairline-strong)",
  "--xy-node-background-color": "var(--page)",
  "--xy-node-color": "var(--ink)",
  "--xy-node-border": "1.5px solid var(--hairline-strong)",
  "--xy-node-border-radius": "14px",
  "--xy-node-boxshadow-hover": "none",
  "--xy-node-boxshadow-selected": "none",
  "--xy-edge-stroke": "var(--hairline-strong)",
  "--xy-edge-stroke-selected": "var(--select)",
  "--xy-edge-stroke-width": "3",
  "--xy-edge-label-background-color": "var(--page)",
  "--xy-edge-label-color": "var(--ink-muted)",
  "--xy-handle-background-color": "var(--card)",
  "--xy-handle-border-color": "var(--select)",
  "--xy-controls-button-background-color": "var(--page)",
  "--xy-controls-button-background-color-hover": "var(--well)",
  "--xy-controls-button-color": "var(--ink)",
  "--xy-controls-button-color-hover": "var(--ink)",
  "--xy-controls-button-border-color": "var(--hairline)",
  "--xy-controls-box-shadow": "none",
  "--xy-attribution-background-color": "transparent",
} as CSSProperties;

// The design's node card: compact, about 120 px wide, in place of React Flow's 150.
export const NODE_STYLE: CSSProperties = {
  width: 124,
  padding: "10px 8px",
  fontSize: 13,
  lineHeight: 1.2,
};

// The design's selected node: the select tint, a 2px select border.
export const SELECTED_NODE =
  "[--xy-node-background-color:var(--distributed-systems-tint)] [--xy-node-border:2px_solid_var(--select)]";

// The editing canvas's handles: drawn on a hovered, focused or selected card (always on a
// touch screen, which can't hover), larger than React Flow's, in the select colour, with
// a hit area wider than the dot. React Flow's stylesheet is unlayered, so it beats
// Tailwind's layered utilities: these need `!`. Nodes and edges reached by Tab show
// the select ring.
export const EDIT_FLOW = [
  "[&_.react-flow__handle]:size-2.5! [&_.react-flow__handle]:border-2!",
  "[&_.react-flow__handle]:after:absolute [&_.react-flow__handle]:after:-inset-[7px] [&_.react-flow__handle]:after:content-['']",
  "pointer-fine:[&_.react-flow__handle]:opacity-0 [&_.react-flow__handle]:transition-opacity",
  "[&_.react-flow__node:hover_.react-flow__handle]:opacity-100",
  "[&_.react-flow__node:focus-visible_.react-flow__handle]:opacity-100",
  "[&_.react-flow__node.selected_.react-flow__handle]:opacity-100",
  "[&_.react-flow__handle:hover]:bg-select!",
  "[&_.react-flow__node:focus-visible]:outline-2! [&_.react-flow__node:focus-visible]:outline-offset-2! [&_.react-flow__node:focus-visible]:outline-select!",
  "[&_.react-flow__edge:focus-visible_.react-flow__edge-path]:stroke-select! [&_.react-flow__edge:focus-visible_.react-flow__edge-path]:stroke-[5]!",
  "[&_.react-flow__edge.selected_.react-flow__edge-path]:stroke-select",
].join(" ");

// Where traffic enters, what computes, what stores, what carries messages.
const RAMP: Record<ComponentKind, string> = {
  client: "distributed-systems",
  cdn: "system-design",
  load_balancer: "system-design",
  app_service: "system-design",
  worker: "review",
  cache: "databases",
  sql_db: "databases",
  kv_store: "databases",
  object_storage: "databases",
  search_index: "databases",
  queue: "review",
  stream: "review",
};

function KindIcon({ kind }: { kind: ComponentKind }) {
  const c = (shade: string) => `var(--${RAMP[kind]}-${shade})`;
  if (kind === "client")
    return (
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke={c("right")}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 20h8M12 16v4" />
      </svg>
    );
  if (kind === "sql_db" || kind === "kv_store")
    return (
      <svg width="22" height="22" viewBox="0 0 40 40" aria-hidden="true">
        <path d="M8 10v20a12 4 0 0 0 24 0V10z" fill={c("left")} />
        <ellipse cx="20" cy="10" rx="12" ry="4" fill={c("top")} />
      </svg>
    );
  if (kind === "queue" || kind === "stream")
    return (
      <svg width="26" height="20" viewBox="0 0 52 40" aria-hidden="true">
        <rect x="2" y="12" width="14" height="16" rx="4" fill={c("top")} />
        <rect x="19" y="12" width="14" height="16" rx="4" fill={c("left")} />
        <rect x="36" y="12" width="14" height="16" rx="4" fill={c("right")} />
      </svg>
    );
  return <Cube size={22} ramp={RAMP[kind]} />;
}

export function Cube({ size, ramp }: { size: number; ramp: string }) {
  const c = (shade: string) => `var(--${ramp}-${shade})`;
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <path d="M20 6 32 12 20 18 8 12z" fill={c("top")} />
      <path d="M8 12 20 18v14L8 26z" fill={c("left")} />
      <path d="M20 18 32 12v14L20 32z" fill={c("right")} />
    </svg>
  );
}

// A node's role in a few words, from its configuration: the second line of its card and
// of the Selected title ("SQL database · primary + 2 replicas").
export function nodeRole(node: DesignNode): string {
  const count = (n: number, one: string, many = `${one}s`) =>
    `${String(n)} ${n === 1 ? one : many}`;
  const where = (c: { regions: number }) =>
    c.regions > 1 ? ` · ${count(c.regions, "region")}` : "";
  switch (node.kind) {
    case "client":
      return "users";
    case "cdn":
      return node.config.ttlSeconds >= 60
        ? `caches ${String(Math.round(node.config.ttlSeconds / 60))} min`
        : `caches ${String(node.config.ttlSeconds)} s`;
    case "load_balancer":
      return count(node.config.zones, "zone") + where(node.config);
    case "app_service":
    case "worker":
    case "kv_store":
      return count(node.config.nodes, "node") + where(node.config);
    case "cache":
      return `${count(node.config.nodes, "node")} × ${String(node.config.memoryGbPerNode)} GB`;
    case "sql_db":
      return (
        (node.config.readReplicas > 0
          ? `primary + ${count(node.config.readReplicas, "replica")}`
          : "primary") + where(node.config)
      );
    case "queue":
    case "stream":
      return "async";
    case "object_storage":
      return "files" + where(node.config);
    case "search_index":
      return count(node.config.shards, "shard") + where(node.config);
  }
}

// A node's face, as the design's: its kind's icon, its name at 13 px, then its role at
// 11 px. Never its id: that's the design's key, not a word for the player.
export function NodeLabel({
  kind,
  name,
  role,
}: {
  kind: ComponentKind;
  name: string;
  role: string;
}) {
  return (
    <span className="flex flex-col items-center gap-0.5">
      <KindIcon kind={kind} />
      <span className="mt-0.5 max-w-full truncate text-[13px] leading-tight font-semibold">
        {name}
      </span>
      <span className="max-w-full truncate text-[11px] leading-tight font-medium text-ink-muted">
        {role}
      </span>
    </span>
  );
}
