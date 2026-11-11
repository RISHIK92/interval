import type { Colour, Description, Element } from "@interval/diagrams";
import { createElement, type ComponentType, type ReactNode } from "react";
import Svg, {
  Ellipse,
  G,
  Line,
  Path,
  Polyline,
  Rect,
  Text,
} from "react-native-svg";
import { useColors } from "./theme";

// P4.5-W25-S01 (ARCH-3, TTS-5): the app's drawing of a shared diagram description,
// the mirror of apps/web/src/app/diagrams/DiagramSvg.tsx: a thin mapping to
// react-native-svg with no geometry of its own; token colours from the theme.
const TAGS: Record<Element["tag"], ComponentType<Record<string, unknown>>> = {
  g: G as ComponentType<Record<string, unknown>>,
  rect: Rect as ComponentType<Record<string, unknown>>,
  path: Path as ComponentType<Record<string, unknown>>,
  ellipse: Ellipse as ComponentType<Record<string, unknown>>,
  line: Line as ComponentType<Record<string, unknown>>,
  polyline: Polyline as ComponentType<Record<string, unknown>>,
  text: Text as ComponentType<Record<string, unknown>>,
};
const COLOURED = new Set(["stroke", "fill"]);
// react-native-svg's name for the web's dominantBaseline (both take "central").
const RENAMED: Record<string, string> = {
  dominantBaseline: "alignmentBaseline",
};

export function DiagramSvg({ description }: { description: Description }) {
  const c = useColors();
  const props = (e: Element) =>
    Object.fromEntries(
      Object.entries(e.attrs).map(([k, v]) => [
        RENAMED[k] ?? k,
        COLOURED.has(k) && v !== "none" ? c[v as Colour] : v,
      ]),
    );
  const draw = (e: Element, index: number): ReactNode =>
    createElement(
      TAGS[e.tag],
      { key: e.key ?? index, ...props(e) },
      e.text,
      ...(e.children ?? []).map(draw),
    );
  const { x, y, width, height } = description.viewBox;
  return (
    <Svg
      accessible
      accessibilityRole="image"
      accessibilityLabel={description.title}
      viewBox={`${String(x)} ${String(y)} ${String(width)} ${String(height)}`}
      width="100%"
      style={{ aspectRatio: width / height }}
    >
      {description.elements.map(draw)}
    </Svg>
  );
}
