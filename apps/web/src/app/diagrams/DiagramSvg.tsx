import type { Description, Element } from "@interval/diagrams";
import { createElement, type ReactNode } from "react";

// P4.5-W25-S01 (ARCH-3, TTS-5): the web's drawing of a shared diagram description. A
// thin mapping to React's SVG elements, with no geometry of its own (the app's mirror
// is apps/mobile/components/DiagramSvg.tsx); token colours become the theme's CSS
// variables, so it follows light and dark.
const COLOURED = new Set(["stroke", "fill"]);

function attrs(e: Element): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(e.attrs).map(([k, v]) => [
      k,
      COLOURED.has(k) && v !== "none" ? `var(--${String(v)})` : v,
    ]),
  );
}

function draw(e: Element, index: number): ReactNode {
  return createElement(
    e.tag,
    { key: e.key ?? index, ...attrs(e) },
    e.text,
    ...(e.children ?? []).map(draw),
  );
}

export function DiagramSvg({ description }: { description: Description }) {
  const { x, y, width, height } = description.viewBox;
  return (
    <svg
      role="img"
      aria-label={description.title}
      viewBox={`${String(x)} ${String(y)} ${String(width)} ${String(height)}`}
      className="h-auto w-full"
    >
      <title>{description.title}</title>
      {description.elements.map(draw)}
    </svg>
  );
}
