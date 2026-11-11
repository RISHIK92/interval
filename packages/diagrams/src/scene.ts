import { stateAt, stepAt } from "./clock";
import { Timeline } from "./timeline";

// P4.5-W27-S01/S02 (TTS-5; Q-P4.5-04): what both full players do with an approved
// timeline, kept in one place (ARCH-2).

// The file is a model's output read back from a bucket, so it is held to the timeline's
// rules here, at the boundary. A failure is null, logged: the player leaves the drawing
// out and the audio and captions carry on.
export async function fetchTimeline(
  url: string,
  fetcher: (url: string) => Promise<Response>,
): Promise<Timeline | null> {
  const response = await fetcher(url);
  if (!response.ok) {
    console.error(`scene: ${url} answered ${String(response.status)}`);
    return null;
  }
  let raw: unknown;
  try {
    raw = await response.json();
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    console.error(`scene: ${url} isn't JSON`, error);
    return null;
  }
  const parsed = Timeline.safeParse(raw);
  if (!parsed.success) {
    console.error(`scene: ${url} isn't a valid timeline`, parsed.error.issues);
    return null;
  }
  return parsed.data;
}

// The step the narration has reached and what it draws; none before the first step or
// while the timeline loads.
export function sceneAt(
  timeline: Timeline | null,
  captions: readonly { start: number }[],
  seconds: number,
): { step: number; state: ReturnType<typeof stateAt> | null } {
  const step = timeline === null ? -1 : stepAt(timeline, captions, seconds);
  return {
    step,
    state: timeline === null || step < 0 ? null : stateAt(timeline, step),
  };
}
