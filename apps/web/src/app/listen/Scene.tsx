"use client";

import type { Caption } from "@interval/api-client";
import { describeDiagram, stateAt, stepAt, Timeline } from "@interval/diagrams";
import { useEffect, useState } from "react";
import { AiBox } from "../ui/AiBox";
import { DiagramSvg } from "../diagrams/DiagramSvg";

// P4.5-W27-S01 (TTS-5, §5G; owner, Q-P4.5-04): the explainer's approved timeline in the
// full player, above the captions, stepping with the narration (the clock both players
// share). Each step is said in a live region for screen readers, the drawing sits in
// the AI box (AI-1), and it fades in at each step only for those who haven't asked for
// less motion.

// The file is a model's output read back from a bucket, so it is held to the timeline's
// rules here, at the boundary. A failure leaves the drawing out, logged; the audio and
// the captions carry on without it.
export async function fetchTimeline(
  url: string,
  fetcher: typeof fetch = fetch,
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

type Loaded = { url: string; timeline: Timeline | null } | null;

// Only the timeline fetched for this explainer: another's drawing never shows under
// this one's captions while the new file loads.
export function timelineFor(loaded: Loaded, url: string): Timeline | null {
  return loaded?.url === url ? loaded.timeline : null;
}

// The live region is there from the start, empty, so the first step's words are
// announced when they arrive (a region inserted already holding text often isn't).
export function SceneView(props: {
  timeline: Timeline | null;
  captions: Caption[];
  time: number;
}) {
  const step =
    props.timeline === null
      ? -1
      : stepAt(props.timeline, props.captions, props.time);
  const state =
    props.timeline === null || step < 0 ? null : stateAt(props.timeline, step);
  return (
    <>
      {state !== null && (
        <AiBox>
          {/* The whole drawing fades in again at each step. */}
          <div key={step} className="motion-safe:animate-fade-in">
            <DiagramSvg
              description={describeDiagram(state.diagram, {
                hidden: state.hidden,
                highlight: state.highlight,
              })}
            />
          </div>
        </AiBox>
      )}
      <p aria-live="polite" className="sr-only">
        {state?.describe ?? ""}
      </p>
    </>
  );
}

export function Scene(props: {
  url: string;
  captions: Caption[];
  time: number;
}) {
  const [loaded, setLoaded] = useState<Loaded>(null);
  useEffect(() => {
    let live = true;
    fetchTimeline(props.url).then(
      (timeline) => {
        if (live) setLoaded({ url: props.url, timeline });
      },
      (error: unknown) => {
        console.error(`scene: ${props.url} couldn't be fetched`, error);
      },
    );
    return () => {
      live = false;
    };
  }, [props.url]);
  return (
    <SceneView
      timeline={timelineFor(loaded, props.url)}
      captions={props.captions}
      time={props.time}
    />
  );
}
