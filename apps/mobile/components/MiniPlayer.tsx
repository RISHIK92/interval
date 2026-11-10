import { router } from "expo-router";
import { useEffect, useSyncExternalStore } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { type ListenState, listen } from "../lib/listen";
import { useColors } from "./theme";

// P4-W23-S02 (§4.1): the global mini-player, above the tab bar; it opens the full
// player. Shown once there's something to play.
export function useListen(): ListenState {
  return useSyncExternalStore(
    (listener) => listen().subscribe(listener),
    () => listen().snapshot(),
  );
}

export const clock = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60))}:${String(whole % 60).padStart(2, "0")}`;
};

export function MiniPlayer() {
  const c = useColors();
  const state = useListen();
  useEffect(() => {
    void listen().load();
  }, []);
  const current = state.current;
  // The one playing stays in reach even if a refresh failed.
  if (current === null && (state.status !== "ready" || state.upNext === null))
    return null;
  const title = current?.concept ?? `Up next: ${state.upNext?.concept ?? ""}`;
  return (
    <View
      style={[styles.bar, { backgroundColor: c.page, borderColor: c.hairline }]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open the player. ${title}, AI explainer`}
        style={styles.text}
        onPress={() => {
          router.push("/listen");
        }}
      >
        <Text numberOfLines={1} style={[styles.title, { color: c.ink }]}>
          {title}
        </Text>
        <Text style={{ color: c["ink-muted"] }}>
          {current === null
            ? "AI explainer · tap to play"
            : `AI explainer · ${clock(state.time)} / ${clock(current.durationSeconds)}`}
        </Text>
      </Pressable>
      {current === null ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={state.playing ? "Pause" : "Play"}
          style={[styles.round, { borderColor: c.hairline }]}
          onPress={() => void listen().toggle()}
        >
          <Text style={{ color: c.ink }}>{state.playing ? "❚❚" : "▶"}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: 1,
  },
  text: { flex: 1 },
  title: { fontWeight: "600" },
  round: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
