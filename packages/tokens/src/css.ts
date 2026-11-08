import { colors, families, type Pair } from "./tokens.ts";

// The web's custom properties: each role as light-dark(), so color-scheme picks one
// (globals.css sets it from the device or the iv_theme cookie).
export function toCss(): string {
  const line = (name: string, pair: Pair) =>
    `  --${name}: light-dark(${pair.light}, ${pair.dark});`;
  const roles = Object.entries(colors).map(([role, pair]) => line(role, pair));
  const topics = Object.entries(families).flatMap(([name, faces]) =>
    Object.entries(faces).map(([face, pair]) => line(`${name}-${face}`, pair)),
  );
  return [
    "/* Generated from packages/tokens (pnpm tokens:codegen). Don't edit by hand. */",
    "",
    ":root {",
    ...roles,
    ...topics,
    "}",
    "",
  ].join("\n");
}
