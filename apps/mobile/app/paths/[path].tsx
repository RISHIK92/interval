import type { PathResponse } from "@interval/api-client";
import { type } from "@interval/tokens";
import {
  router,
  Stack,
  useFocusEffect,
  useLocalSearchParams,
} from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useColors } from "../../components/theme";
import { readPath, setPath } from "../../lib/paths";
import { startQuiz } from "../../lib/quiz";

// P4-W21-S03 (§5F, Q-P2-26): a path's sections in order: their readings (into the app's
// reader, counted as the web's from=path) and checkpoints (the native quiz). Editing the
// path stays on the web (owner, 2026-11-09).
export default function PathScreen() {
  const c = useColors();
  const pathId = String(useLocalSearchParams().path ?? "");
  const [path, setShown] = useState<
    PathResponse | "loading" | "gone" | "failed"
  >("loading");
  const [said, setSaid] = useState<string | null>(null);

  const [reads, setReads] = useState(0);
  // Read again on return (a reading finished or a checkpoint passed shows), and after
  // Start or Resume.
  useFocusEffect(
    useCallback(() => {
      let current = true;
      void readPath(pathId)
        .catch((error: unknown) => {
          console.warn("path: not read", error);
          return { status: "failed" } as const;
        })
        .then((got) => {
          if (!current) return;
          setShown(
            got.status === "ok"
              ? got.value
              : got.status === "none"
                ? "gone"
                : "failed",
          );
        });
      return () => {
        current = false;
      };
    }, [pathId, reads]),
  );

  if (typeof path === "string")
    return (
      <View style={[styles.page, { backgroundColor: c.page }]}>
        <Text style={{ color: c.ink }}>
          {path === "loading"
            ? "Loading…"
            : path === "gone"
              ? "This path isn't available."
              : "Couldn't load the path."}
        </Text>
      </View>
    );

  const start = () => {
    setSaid(null);
    void setPath(path.pathId, "start")
      .catch((error: unknown) => {
        console.warn("path: not started", error);
        return false;
      })
      .then((ok) => {
        if (ok) setReads((n) => n + 1);
        else setSaid("Couldn't start the path. Try again.");
      });
  };

  const checkpoint = (sectionId: string) => {
    setSaid(null);
    void startQuiz({ sectionId })
      .catch((error: unknown) => {
        console.warn("path: checkpoint not started", error);
        return { status: "failed" } as const;
      })
      .then((got) => {
        if (got.status === "ok") router.push(`/quiz/${got.value.attemptId}`);
        else
          setSaid(
            got.status === "none"
              ? "This checkpoint isn't ready."
              : "Couldn't start the checkpoint. Try again.",
          );
      });
  };

  return (
    <ScrollView
      style={{ backgroundColor: c.page }}
      contentContainerStyle={styles.page}
    >
      <Stack.Screen options={{ title: path.name }} />
      <Text style={{ color: c.ink }}>{path.why}</Text>
      {path.retired ? (
        <Text style={{ color: c["ink-muted"] }}>
          This path was retired. Your progress stays, but it gets no updates.
        </Text>
      ) : null}
      {path.mine !== "active" && !path.retired ? (
        <Pressable
          accessibilityRole="button"
          onPress={start}
          style={[styles.pill, { backgroundColor: c.ink }]}
        >
          <Text style={{ color: c.page }}>
            {path.mine === "paused" ? "Resume this path" : "Start this path"}
          </Text>
        </Pressable>
      ) : null}
      {path.mine === null || path.retired ? null : (
        <Text style={{ color: c["ink-muted"] }}>
          To move, skip or swap sections, edit this path on the web.
        </Text>
      )}
      {said === null ? null : (
        <Text accessibilityLiveRegion="polite" style={{ color: c.ink }}>
          {said}
        </Text>
      )}
      {path.sections.map((section, i) => {
        const after = path.sections[i + 1];
        const blocker = path.sections.slice(0, i).findLast((s) => s.holdsBack);
        return (
          <View
            key={section.sectionId}
            style={[
              styles.card,
              { borderColor: c.hairline, opacity: section.skipped ? 0.6 : 1 },
            ]}
          >
            <Text style={[styles.title, { color: c.ink }]}>
              {section.concepts.join(", ")}
            </Text>
            {section.open ? null : (
              <Text style={{ color: c["ink-muted"] }}>
                {`Locked · unlocks after the ${blocker?.concepts.join(", ") ?? ""} checkpoint`}
              </Text>
            )}
            {section.readings.map((r) =>
              // As the web: a locked section's readings are listed, not opened.
              !section.open || r.linkBroken ? (
                <Text key={r.momentId} style={{ color: c["ink-muted"] }}>
                  {r.linkBroken
                    ? `${r.sectionTitle} · link broken`
                    : r.sectionTitle}
                </Text>
              ) : (
                <Pressable
                  key={r.momentId}
                  accessibilityRole="link"
                  accessibilityLabel={`${r.finished ? "Finished: " : ""}${r.sectionTitle}`}
                  onPress={() => {
                    router.push(
                      `/read/${r.itemId}?moment=${r.momentId}&path=${path.pathId}`,
                    );
                  }}
                  style={styles.reading}
                >
                  <Text style={{ color: c.ink }}>
                    {`${r.finished ? "✓ " : ""}${r.sectionTitle}`}
                  </Text>
                  <Text style={{ color: c["ink-muted"] }}>
                    {`${r.articleTitle} · ${r.sourceName} · ${String(r.minutes)} min`}
                  </Text>
                </Pressable>
              ),
            )}
            {/* As the web's checkpoint row. */}
            <Text style={{ color: c["ink-muted"] }}>
              {section.checkpoint === "passed"
                ? "Checkpoint passed"
                : section.checkpoint === "skipped"
                  ? "Skipped · no checkpoint"
                  : section.size === 0
                    ? "Checkpoint"
                    : `Checkpoint · Pass ${String(section.passMark)} of ${String(section.size)} ${
                        after === undefined
                          ? "to finish the path"
                          : `to unlock ${after.concepts.join(", ")}`
                      }`}
            </Text>
            {section.checkpoint === "ready" && path.mine === "active" ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  checkpoint(section.sectionId);
                }}
                style={[styles.pill, { backgroundColor: c.ink }]}
              >
                <Text style={{ color: c.page }}>Take the checkpoint</Text>
              </Pressable>
            ) : section.checkpoint === "no_questions" ? (
              <Text style={{ color: c["ink-muted"] }}>
                Checkpoint not ready yet
              </Text>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12 },
  card: { borderWidth: 1, borderRadius: 20, padding: 16, gap: 8 },
  title: { fontSize: type.section.size, fontWeight: type.section.weight },
  reading: { gap: 2 },
  pill: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
});
