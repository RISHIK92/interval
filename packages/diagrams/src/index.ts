// P4.5-W25-S01 (ARCH-3, TTS-5, CANVAS-1): the shared diagram library. Only what the
// renderers use; the rest stays inside until a caller needs it.
export { Diagram } from "./diagram";
export {
  type Colour,
  type Description,
  describeDiagram,
  type Element,
} from "./describe";
export { stateAt } from "./clock";
export { fetchTimeline, sceneAt } from "./scene";
export { checkAnchors, Timeline } from "./timeline";
