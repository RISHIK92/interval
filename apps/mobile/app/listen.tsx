import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { clock, useListen } from "../components/MiniPlayer";
import { useColors } from "../components/theme";
import { listen, SKIP_SECONDS } from "../lib/listen";

// P4-W23-S02 (§5G, wireframe 07): the full player. Only Smart explain is voiced so far
// (owner, 2026-11-10); every explainer is AI (AI-1) and cites its sections (AI-3).
export default function ListenScreen() {
  const c = useColors();
  const state = useListen();
  const current = state.current;
  const upNext = state.upNext;
  const shown = current ?? upNext;
  const later = state.queue.filter(
    (q) => q.explainerId !== current?.explainerId,
  );
  const button = (label: string, text: string, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.round, { borderColor: c.hairline }]}
    >
      <Text style={{ color: c.ink }}>{text}</Text>
    </Pressable>
  );
  return (
    <ScrollView
      style={{ backgroundColor: c.page }}
      contentContainerStyle={styles.page}
    >
      <View
        accessibilityRole="radiogroup"
        style={[styles.modes, { backgroundColor: c.well }]}
      >
        <Pressable
          accessibilityRole="radio"
          accessibilityLabel="Original. Coming later"
          accessibilityState={{ disabled: true, checked: false }}
          disabled
          style={[styles.mode, { opacity: 0.5 }]}
        >
          <Text style={{ color: c["ink-muted"] }}>Original</Text>
        </Pressable>
        <View
          accessibilityRole="radio"
          accessibilityLabel="Smart explain"
          accessibilityState={{ checked: true }}
          style={[styles.mode, { backgroundColor: c.page }]}
        >
          <Text style={[styles.strong, { color: c.ink }]}>Smart explain</Text>
        </View>
      </View>
      <Text style={[styles.center, { color: c["ink-muted"] }]}>
        You’re hearing AI, not the author.
      </Text>
      {shown === null ? (
        <Text style={[styles.center, { color: c["ink-muted"] }]}>
          Nothing queued. Listen in the reader adds a section’s AI explainers.
        </Text>
      ) : (
        <Text
          accessibilityRole="header"
          style={[styles.concept, { color: c.ink }]}
        >
          {shown.concept}
        </Text>
      )}
      {current === null ? null : (
        <>
          <Text style={[styles.center, { color: c["ink-muted"] }]}>
            {clock(state.time)} / {clock(current.durationSeconds)}
          </Text>
          <View style={styles.controls}>
            {button(
              `Back ${String(SKIP_SECONDS)} seconds`,
              `−${String(SKIP_SECONDS)}`,
              () => {
                listen().skip(-SKIP_SECONDS);
              },
            )}
            {button(
              state.playing ? "Pause" : "Play",
              state.playing ? "❚❚" : "▶",
              () => {
                void listen().toggle();
              },
            )}
            {button(
              `Forward ${String(SKIP_SECONDS)} seconds`,
              `+${String(SKIP_SECONDS)}`,
              () => {
                listen().skip(SKIP_SECONDS);
              },
            )}
            {button(
              `Speed ${String(state.speed)}×. Change speed`,
              `${String(state.speed)}×`,
              () => {
                listen().cycleSpeed();
              },
            )}
          </View>
        </>
      )}
      {state.error === null ? null : (
        <Text
          accessibilityRole="alert"
          style={[styles.center, { color: c.ink }]}
        >
          {state.error}
        </Text>
      )}
      {later.length > 0 ? (
        <View style={styles.list}>
          <Text style={[styles.strong, { color: c.ink }]}>In your queue</Text>
          {later.map((q) => (
            <Pressable
              key={q.explainerId}
              accessibilityRole="button"
              accessibilityLabel={`Play ${q.concept}`}
              onPress={() => void listen().play(q.explainerId)}
            >
              <Text style={{ color: c.ink }}>{q.concept}</Text>
            </Pressable>
          ))}
        </View>
      ) : upNext !== null && current === null ? (
        // Wireframe 07: along the concept graph, played only on a tap.
        <View style={styles.list}>
          <Text style={{ color: c["ink-muted"] }}>Up next</Text>
          {button(`Play ${upNext.concept}`, "▶ Play", () => {
            void listen().play(upNext.explainerId);
          })}
        </View>
      ) : null}
      {shown === null || shown.sources.length === 0 ? null : (
        <View style={[styles.sources, { borderColor: c.hairline }]}>
          <Text style={[styles.strong, { color: c.ink }]}>
            Written from <Text style={{ color: c["ink-muted"] }}>· AI</Text>
          </Text>
          {shown.sources.map((s) => (
            <Pressable
              key={s.href}
              accessibilityRole="link"
              onPress={() => void Linking.openURL(s.href)}
            >
              <Text style={[styles.link, { color: c.ink }]}>{s.title}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 24, gap: 16 },
  modes: {
    flexDirection: "row",
    alignSelf: "center",
    borderRadius: 999,
    padding: 4,
  },
  mode: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  strong: { fontWeight: "600" },
  center: { textAlign: "center" },
  concept: { fontSize: 24, fontWeight: "600", textAlign: "center" },
  controls: { flexDirection: "row", justifyContent: "center", gap: 12 },
  round: {
    minWidth: 44,
    height: 44,
    paddingHorizontal: 10,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  list: { gap: 8 },
  sources: {
    gap: 6,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 12,
    padding: 12,
  },
  link: { textDecorationLine: "underline" },
});
