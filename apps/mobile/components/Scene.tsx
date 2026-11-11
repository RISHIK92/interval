import type { Caption } from "@interval/api-client";
import {
  describeDiagram,
  fetchTimeline,
  sceneAt,
  type Timeline,
} from "@interval/diagrams";
import { useEffect, useState } from "react";
import { AccessibilityInfo, StyleSheet, Text, View } from "react-native";
import { DiagramSvg } from "./DiagramSvg";
import { useColors } from "./theme";

// P4.5-W27-S02 (TTS-5, §5G; owner, Q-P4.5-04): the explainer's approved timeline in the
// app's full player, above the captions, stepping with the narration; the web's mirror
// is apps/web/src/app/listen/Scene.tsx, and fetching and the clock are shared
// (packages/diagrams). In a dashed AI box (AI-1). Each step is announced to screen
// readers as it comes, the first one included (a live region mounted already holding
// text often isn't read, and iOS has none). Steps appear without animation, which is
// what reduced motion asks for.
export function Scene(props: {
  url: string;
  captions: Caption[];
  time: number;
}) {
  const c = useColors();
  const [loaded, setLoaded] = useState<{
    url: string;
    timeline: Timeline | null;
  } | null>(null);
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
  // Only this explainer's timeline: never the last one's while the next one loads.
  const timeline = loaded?.url === props.url ? loaded.timeline : null;
  const { step, state } = sceneAt(timeline, props.captions, props.time);
  const said = state?.describe ?? null;
  useEffect(() => {
    if (said !== null) AccessibilityInfo.announceForAccessibility(said);
  }, [step, said]);
  if (state === null) return null;
  return (
    // The description is for screen readers only, as on the web: the box reads as the
    // drawing's title and what this step shows.
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${state.diagram.title}. ${state.describe} AI-drawn.`}
      style={[styles.box, { borderColor: c.hairline }]}
    >
      <DiagramSvg
        description={describeDiagram(state.diagram, {
          hidden: state.hidden,
          highlight: state.highlight,
        })}
      />
      <Text style={[styles.tag, { color: c["ink-muted"] }]}>AI</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  tag: { fontSize: 12, fontWeight: "600", alignSelf: "flex-end" },
});
