import { type Arrow, DEFAULT_SIZE, type Diagram, type Shape } from "./diagram";

// P4.5-W25-S01 (TTS-5, ARCH-3): how a diagram is drawn, as plain SVG element data.
// Each platform maps it to its own SVG components (React DOM on the web,
// react-native-svg in the app) and never computes geometry itself, so both draw the
// same picture. Attribute names are React's camelCase, which both renderers take;
// colours are design-token names each platform resolves to its theme. Each shape is
// drawn at its own origin and placed by its group's translate, so a React Flow node
// (CANVAS-1) can reuse a shape's drawing as is, and a scene step can move it whole.

export const CELL = 40;

export type Colour = "ink" | "ink-muted" | "well" | "page" | "select";
export type Element = {
  // A shape's id, or an arrow's from->to, on its outermost element (scene steps find
  // them by it).
  key?: string;
  tag: "g" | "rect" | "path" | "ellipse" | "line" | "polyline" | "text";
  attrs: Record<string, string | number>;
  // A text element's words: data, never markup.
  text?: string;
  children?: Element[];
};
export type Description = {
  title: string;
  viewBox: { x: number; y: number; width: number; height: number };
  elements: Element[];
};

type Box = { x: number; y: number; w: number; h: number };

// SVG path commands and numbers, space-separated.
const path = (...parts: (string | number)[]) => parts.join(" ");
const round = (n: number) => Math.round(n * 100) / 100;

const boxOf = (s: Shape): Box => {
  const size = s.size ?? DEFAULT_SIZE[s.kind];
  return {
    x: s.at.col * CELL,
    y: s.at.row * CELL,
    w: size.cols * CELL,
    h: size.rows * CELL,
  };
};

const label = (
  text: string,
  x: number,
  y: number,
  fill: Colour = "ink",
): Element => ({
  tag: "text",
  attrs: {
    x,
    y,
    textAnchor: "middle",
    dominantBaseline: "central",
    fontSize: 13,
    fill,
  },
  text,
});

// A group's name, at its top left.
const groupLabel = (text: string): Element => {
  const at = label(text, 8, 16, "ink-muted");
  return { ...at, attrs: { ...at.attrs, textAnchor: "start", fontSize: 12 } };
};

// Each kind is told apart by its outline (never colour alone); a highlighted shape
// gets a heavier outline in the select colour. Drawn at (0, 0), w by h.
function parts(s: Shape, w: number, h: number, lit: boolean): Element[] {
  const line = { stroke: lit ? "select" : "ink", strokeWidth: lit ? 3 : 1.5 };
  const body = { fill: "well", ...line };
  const cx = w / 2;
  const cy = h / 2;
  switch (s.kind) {
    case "service":
      return [
        {
          tag: "rect",
          attrs: { ...body, x: 0, y: 0, width: w, height: h, rx: 6 },
        },
        label(s.label, cx, cy),
      ];
    case "client": {
      // A screen on a stand.
      const screen = h * 0.7;
      return [
        {
          tag: "rect",
          attrs: { ...body, x: 0, y: 0, width: w, height: screen, rx: 4 },
        },
        {
          tag: "line",
          attrs: { ...line, x1: cx, y1: screen, x2: cx, y2: h - 4 },
        },
        {
          tag: "line",
          attrs: {
            ...line,
            x1: cx - w / 4,
            y1: h - 4,
            x2: cx + w / 4,
            y2: h - 4,
          },
        },
        label(s.label, cx, screen / 2),
      ];
    }
    case "database": {
      // A cylinder: its body, then its lid.
      const e = Math.min(10, h / 6);
      return [
        {
          tag: "path",
          attrs: {
            ...body,
            d: path(
              "M",
              0,
              e,
              "V",
              h - e,
              "A",
              w / 2,
              e,
              0,
              0,
              0,
              w,
              h - e,
              "V",
              e,
            ),
          },
        },
        { tag: "ellipse", attrs: { ...body, cx, cy: e, rx: w / 2, ry: e } },
        label(s.label, cx, cy + e / 2),
      ];
    }
    case "cache":
      // A box with a lightning mark: fast, in memory.
      return [
        {
          tag: "rect",
          attrs: { ...body, x: 0, y: 0, width: w, height: h, rx: 6 },
        },
        {
          tag: "polyline",
          attrs: {
            ...line,
            fill: "none",
            points: [
              [w - 14, 5],
              [w - 20, 14],
              [w - 12, 14],
              [w - 18, 23],
            ]
              .map((p) => p.join(","))
              .join(" "),
          },
        },
        label(s.label, cx - 6, cy),
      ];
    case "queue":
      // A box with slots along its right end: messages waiting in order.
      return [
        {
          tag: "rect",
          attrs: { ...body, x: 0, y: 0, width: w, height: h, rx: 4 },
        },
        ...[1, 2, 3].map((k): Element => ({
          tag: "line",
          attrs: { ...line, x1: w - k * 10, y1: 6, x2: w - k * 10, y2: h - 6 },
        })),
        label(s.label, (w - 30) / 2, cy),
      ];
    case "group":
      // A dashed boundary behind what it holds, its label at the top left.
      return [
        {
          tag: "rect",
          attrs: {
            ...line,
            stroke: lit ? "select" : "ink-muted",
            fill: "none",
            strokeDasharray: "6 4",
            x: 0,
            y: 0,
            width: w,
            height: h,
            rx: 8,
          },
        },
        groupLabel(s.label),
      ];
    case "note": {
      // A page with a folded corner.
      const f = 12;
      return [
        {
          tag: "path",
          attrs: {
            ...line,
            stroke: lit ? "select" : "ink-muted",
            fill: "page",
            d: path(
              "M",
              0,
              0,
              "H",
              w - f,
              "L",
              w,
              f,
              "V",
              h,
              "H",
              0,
              "Z",
              "M",
              w - f,
              0,
              "V",
              f,
              "H",
              w,
            ),
          },
        },
        label(s.label, cx, cy, "ink-muted"),
      ];
    }
  }
}

function shape(s: Shape, lit: boolean): Element {
  const b = boxOf(s);
  return {
    key: s.id,
    tag: "g",
    attrs: { transform: `translate(${String(b.x)} ${String(b.y)})` },
    children: parts(s, b.w, b.h, lit),
  };
}

const centre = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

// Where the line from a box's centre toward a point leaves the box.
function edge(b: Box, toward: { x: number; y: number }) {
  const c = centre(b);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  const t = Math.min(
    dx === 0 ? Infinity : b.w / 2 / Math.abs(dx),
    dy === 0 ? Infinity : b.h / 2 / Math.abs(dy),
  );
  return t === Infinity ? c : { x: c.x + dx * t, y: c.y + dy * t };
}

export const arrowKey = (a: Arrow) => `${a.from}->${a.to}`;

// The line and its head, then its label (drawn above every shape, so a shape never
// covers it). The head points from centre to centre, so it is right even where the
// boxes touch.
function arrow(a: Arrow, from: Box, to: Box, lit: boolean): Element[] {
  const start = edge(from, centre(to));
  const end = edge(to, centre(from));
  const angle = Math.atan2(
    centre(to).y - centre(from).y,
    centre(to).x - centre(from).x,
  );
  const head = (turn: number) => ({
    x: end.x - 9 * Math.cos(angle + turn),
    y: end.y - 9 * Math.sin(angle + turn),
  });
  const left = head(Math.PI / 7);
  const right = head(-Math.PI / 7);
  const ink = lit ? "select" : "ink";
  const key = arrowKey(a);
  const drawn: Element = {
    key,
    tag: "g",
    attrs: {},
    children: [
      {
        tag: "line",
        attrs: {
          x1: round(start.x),
          y1: round(start.y),
          x2: round(end.x),
          y2: round(end.y),
          stroke: ink,
          strokeWidth: lit ? 3 : 1.5,
          ...(a.style === "dashed" ? { strokeDasharray: "6 4" } : {}),
        },
      },
      {
        tag: "path",
        attrs: {
          d: path(
            "M",
            round(end.x),
            round(end.y),
            "L",
            round(left.x),
            round(left.y),
            "L",
            round(right.x),
            round(right.y),
            "Z",
          ),
          fill: ink,
          stroke: ink,
          strokeWidth: 1,
        },
      },
    ],
  };
  if (a.label === undefined) return [drawn];
  return [
    drawn,
    {
      key: `${key}:label`,
      tag: "text",
      attrs: {
        x: round((start.x + end.x) / 2),
        y: round((start.y + end.y) / 2 - 8),
        textAnchor: "middle",
        dominantBaseline: "central",
        fontSize: 12,
        fill: lit ? "select" : "ink-muted",
      },
      text: a.label,
    },
  ];
}

// highlight and hidden take shape ids and arrow keys (from->to). The view box holds
// every shape, shown or not, so the picture doesn't move as a scene reveals it.
export function describeDiagram(
  diagram: Diagram,
  options: { highlight?: string[]; hidden?: string[] } = {},
): Description {
  const hidden = new Set(options.hidden ?? []);
  const lit = new Set(options.highlight ?? []);
  const every = diagram.shapes.map(boxOf);
  const minX = Math.min(...every.map((b) => b.x));
  const minY = Math.min(...every.map((b) => b.y));
  const maxX = Math.max(...every.map((b) => b.x + b.w));
  const maxY = Math.max(...every.map((b) => b.y + b.h));
  const shown = diagram.shapes.filter((s) => !hidden.has(s.id));
  const boxes = new Map(shown.map((s) => [s.id, boxOf(s)]));
  const arrows = diagram.arrows.flatMap((a) => {
    const from = boxes.get(a.from);
    const to = boxes.get(a.to);
    return from === undefined || to === undefined || hidden.has(arrowKey(a))
      ? []
      : arrow(a, from, to, lit.has(arrowKey(a)));
  });
  // Groups at the back, arrows under the shapes they join, labels on top.
  return {
    title: diagram.title,
    viewBox: {
      x: minX - CELL / 2,
      y: minY - CELL / 2,
      width: maxX - minX + CELL,
      height: maxY - minY + CELL,
    },
    elements: [
      ...shown
        .filter((s) => s.kind === "group")
        .map((s) => shape(s, lit.has(s.id))),
      ...arrows.filter((e) => e.tag === "g"),
      ...shown
        .filter((s) => s.kind !== "group")
        .map((s) => shape(s, lit.has(s.id))),
      ...arrows.filter((e) => e.tag === "text"),
    ],
  };
}
