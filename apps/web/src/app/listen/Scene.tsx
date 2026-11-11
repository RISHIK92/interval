"use client";

import type { Caption } from "@interval/api-client";
import {
  describeDiagram,
  fetchTimeline,
  sceneAt,
  type Timeline,
} from "@interval/diagrams";
import { useEffect, useState } from "react";
import { AiBox } from "../ui/AiBox";
import { DiagramSvg } from "../diagrams/DiagramSvg";

// P4.5-W27-S01 (TTS-5, §5G; owner, Q-P4.5-04): the explainer's approved timeline in the
// full player, above the captions, stepping with the narration (the clock both players
// share). Each step is said in a live region for screen readers, the drawing sits in
// the AI box (AI-1), and it fades in at each step only for those who haven't asked for
// less motion.

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
  const { step, state } = sceneAt(props.timeline, props.captions, props.time);
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
    fetchTimeline(props.url, (url) => fetch(url)).then(
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
