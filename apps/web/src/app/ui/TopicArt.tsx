import type { Topic } from "@interval/db";

// "Every topic gets a color and a picture of the idea" (design system): an isometric
// drawing per topic in its family's colours. Decorative, so hidden from screen readers.
const v = (topic: Topic, role: string) => `var(--${topic}-${role})`;

// SVG path data from numbers: each number spelled out, as the lint rules want.
const d = (parts: TemplateStringsArray, ...values: number[]) =>
  parts.reduce(
    (path, part, i) =>
      path + part + (i < values.length ? String(values[i]) : ""),
    "",
  );

function Cylinder({
  topic,
  x,
  y,
  s,
}: {
  topic: Topic;
  x: number;
  y: number;
  s: number;
}) {
  const w = 34 * s;
  const h = 40 * s;
  const ry = 9 * s;
  return (
    <g>
      <path
        d={d`M${x - w} ${y} v${h} a${w} ${ry} 0 0 0 ${2 * w} 0 v${-h}`}
        fill={v(topic, "left")}
      />
      {[0.33, 0.66].map((f) => (
        <path
          key={f}
          d={d`M${x - w} ${y + h * f} a${w} ${ry} 0 0 0 ${2 * w} 0`}
          fill="none"
          stroke={v(topic, "top")}
          strokeWidth={2 * s}
        />
      ))}
      <ellipse cx={x} cy={y} rx={w} ry={ry} fill={v(topic, "top")} />
    </g>
  );
}

function Cube({
  topic,
  x,
  y,
  s,
}: {
  topic: Topic;
  x: number;
  y: number;
  s: number;
}) {
  const a = 30 * s;
  const b = 17 * s;
  return (
    <g>
      <path
        d={d`M${x} ${y} l${a} ${b} l${-a} ${b} l${-a} ${-b}z`}
        fill={v(topic, "top")}
      />
      <path
        d={d`M${x - a} ${y + b} l${a} ${b} v${2 * b} l${-a} ${-b}z`}
        fill={v(topic, "left")}
      />
      <path
        d={d`M${x + a} ${y + b} l${-a} ${b} v${2 * b} l${a} ${-b}z`}
        fill={v(topic, "right")}
      />
    </g>
  );
}

const line = (topic: Topic) => ({
  stroke: v(topic, "line"),
  strokeWidth: 3,
  strokeDasharray: "2 8",
  strokeLinecap: "round" as const,
  fill: "none",
});

export function TopicArt({
  topic,
  className = "",
}: {
  topic: Topic;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 320 120"
      className={className}
      style={{ background: v(topic, "tint") }}
    >
      {topic === "databases" ? (
        <>
          <path d="M120 60 L200 60" {...line(topic)} />
          <Cylinder topic={topic} x={90} y={35} s={1} />
          <Cylinder topic={topic} x={225} y={50} s={0.8} />
        </>
      ) : topic === "distributed-systems" ? (
        <>
          <path d="M115 55 L180 35 M115 70 L190 88" {...line(topic)} />
          <Cylinder topic={topic} x={85} y={42} s={0.95} />
          <Cylinder topic={topic} x={210} y={22} s={0.65} />
          <Cylinder topic={topic} x={220} y={72} s={0.65} />
        </>
      ) : topic === "system-design" ? (
        <>
          <path d="M120 60 L165 50 M195 50 L235 60" {...line(topic)} />
          <Cube topic={topic} x={95} y={30} s={1} />
          <Cube topic={topic} x={180} y={22} s={0.8} />
          <Cylinder topic={topic} x={255} y={52} s={0.7} />
        </>
      ) : (
        <>
          <path d="M150 62 L215 62" {...line(topic)} />
          <Cube topic={topic} x={110} y={26} s={1.05} />
          <Cube topic={topic} x={245} y={36} s={0.75} />
        </>
      )}
    </svg>
  );
}
