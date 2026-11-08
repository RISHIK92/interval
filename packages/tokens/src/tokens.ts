// ARCH-3, P4-W19-S02: the design system's tokens (docs/wireframes/design-system.html,
// owner 2026-10-26), once for both apps. The web's CSS is generated from these
// (`pnpm tokens:codegen`); the app reads them directly.

export type Pair = { light: string; dark: string };

export const colors = {
  page: { light: "#ffffff", dark: "#0e1014" },
  well: { light: "#f3f4f6", dark: "#1a1d23" },
  track: { light: "#e6e8ec", dark: "#2a2e36" },
  hairline: { light: "#e4e6eb", dark: "#262a32" },
  ink: { light: "#101217", dark: "#f3f4f6" },
  "ink-muted": { light: "#666c78", dark: "#8f95a1" },
  go: { light: "#12a150", dark: "#35d07f" },
  "go-text": { light: "#0b7a3e", dark: "#35d07f" },
  "go-soft": { light: "#9fe3bb", dark: "#1d6b42" },
  select: { light: "#3462e8", dark: "#7b9cff" },
  live: { light: "#e5404a", dark: "#ff6b72" },
  wrong: { light: "#c62f38", dark: "#ff7b82" },
  shadow: { light: "rgba(16, 18, 23, 0.07)", dark: "transparent" },
  // A chosen segment: lifted white in light, a raised grey in dark (no shadows).
  lift: { light: "#ffffff", dark: "#2a2e36" },
} as const satisfies Record<string, Pair>;

// Topic families: tint, top face, left face, right face, lines. Review is the design's
// family for cards and memory strength; backend has none yet and borrows it.
const family = (
  tint: Pair,
  top: Pair,
  left: Pair,
  right: Pair,
  line: Pair,
) => ({ tint, top, left, right, line });

const review = family(
  { light: "#f1ebff", dark: "#241b42" },
  { light: "#cdb8ff", dark: "#cab5ff" },
  { light: "#9468f7", dark: "#8457f0" },
  { light: "#7444e0", dark: "#5f36c4" },
  { light: "#5b32c2", dark: "#d4c2ff" },
);

export const families = {
  "distributed-systems": family(
    { light: "#e9eeff", dark: "#161f3d" },
    { light: "#a9beff", dark: "#9db4ff" },
    { light: "#5b86ff", dark: "#5b82f5" },
    { light: "#3462e8", dark: "#3557c4" },
    { light: "#2448c2", dark: "#b4c6ff" },
  ),
  databases: family(
    { light: "#def6f1", dark: "#0d2b27" },
    { light: "#8fe3d3", dark: "#86e0cf" },
    { light: "#1db9a1", dark: "#19a890" },
    { light: "#0e957f", dark: "#0c7867" },
    { light: "#0a7a69", dark: "#9be8d9" },
  ),
  "system-design": family(
    { light: "#fff0e0", dark: "#33200e" },
    { light: "#ffcb99", dark: "#ffc896" },
    { light: "#ff9440", dark: "#ee8430" },
    { light: "#e2711a", dark: "#b85f15" },
    { light: "#b5560b", dark: "#ffcfa3" },
  ),
  review,
  backend: review,
} as const;

// Type: Outfit, tight on headings (sizes in px; letter spacing in em).
export const type = {
  display: { size: 28, weight: 700, lineHeight: 1.15, letterSpacing: -0.02 },
  title: { size: 21, weight: 700, lineHeight: 1.2, letterSpacing: -0.015 },
  section: { size: 17, weight: 600, lineHeight: 1.3, letterSpacing: 0 },
  body: { size: 15, weight: 400, lineHeight: 1.45, letterSpacing: 0 },
} as const;

export type Scheme = keyof Pair;

// One scheme's colors, flat, for a native style sheet.
export function palette(scheme: Scheme): Record<keyof typeof colors, string> {
  return Object.fromEntries(
    Object.entries(colors).map(([role, pair]) => [role, pair[scheme]]),
  ) as Record<keyof typeof colors, string>;
}
