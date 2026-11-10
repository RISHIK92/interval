import { useEffect } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { clock, useListen } from "../../components/MiniPlayer";
import { useColors } from "../../components/theme";
import { listen } from "../../lib/listen";

// P4-W23-S02 (§5I): Library's audio queue, shared with the web. Saved items, notes and
// history stay on the web for now.
export default function LibraryScreen() {
  const c = useColors();
  const state = useListen();
  useEffect(() => {
    void listen().load();
  }, []);
  return (
    <ScrollView
      style={{ backgroundColor: c.page }}
      contentContainerStyle={styles.page}
    >
      <Text
        accessibilityRole="header"
        style={[styles.heading, { color: c.ink }]}
      >
        Audio queue
      </Text>
      {state.status === "failed" ? (
        <Text style={{ color: c.ink }}>Couldn’t load your audio queue.</Text>
      ) : state.queue.length === 0 ? (
        <Text style={{ color: c["ink-muted"] }}>
          Nothing queued. Listen in the reader adds a section’s AI explainers
          here.
        </Text>
      ) : (
        state.queue.map((q) => (
          <View
            key={q.explainerId}
            style={[styles.row, { borderColor: c.hairline }]}
          >
            <View style={styles.text}>
              <Text style={[styles.title, { color: c.ink }]}>{q.concept}</Text>
              <Text style={{ color: c["ink-muted"] }}>
                AI explainer · {clock(q.durationSeconds)}
                {q.positionSeconds > 0
                  ? ` · at ${clock(q.positionSeconds)}`
                  : ""}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Play ${q.concept}`}
              style={[styles.pill, { backgroundColor: c.ink }]}
              onPress={() => void listen().play(q.explainerId)}
            >
              <Text style={{ color: c.page }}>Play</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${q.concept}`}
              style={[styles.pill, { borderColor: c.hairline, borderWidth: 1 }]}
              onPress={() => void listen().remove(q.explainerId)}
            >
              <Text style={{ color: c.ink }}>Remove</Text>
            </Pressable>
          </View>
        ))
      )}
      <Text style={{ color: c["ink-muted"] }}>
        Saved items, notes and history are in Library on the web.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12 },
  heading: { fontSize: 20, fontWeight: "600" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  text: { flex: 1 },
  title: { fontWeight: "600" },
  pill: {
    minHeight: 44,
    paddingHorizontal: 14,
    justifyContent: "center",
    borderRadius: 999,
  },
});
