import type { QuizResults } from "@interval/api-client";
import { type } from "@interval/tokens";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useColors } from "../../../components/theme";
import { SITE } from "../../../lib/auth";
import { readResults } from "../../../lib/quiz";

const leave = () => {
  if (router.canGoBack()) router.back();
  else router.replace("/play");
};

// P4-W21-S01 (§6.3): a finished attempt's results, read only; a running one goes back to
// its quiz, as the web's results page does. The daily's card is shared as its link, as
// the web's Share button does.
export default function ResultsScreen() {
  const c = useColors();
  const attempt = String(useLocalSearchParams().attempt ?? "");
  const [results, setResults] = useState<QuizResults | "loading" | "failed">(
    "loading",
  );

  useEffect(() => {
    let current = true;
    void readResults(attempt)
      .catch((error: unknown) => {
        console.warn("results: not read", error);
        return { status: "failed" } as const;
      })
      .then((got) => {
        if (!current) return;
        if (got.status === "conflict") router.replace(`/quiz/${attempt}`);
        else setResults(got.status === "ok" ? got.value : "failed");
      });
    return () => {
      current = false;
    };
  }, [attempt]);

  if (results === "loading" || results === "failed")
    return (
      <View style={[styles.page, { backgroundColor: c.page }]}>
        <Text style={{ color: c.ink }}>
          {results === "loading" ? "Loading…" : "Couldn't load the results."}
        </Text>
      </View>
    );
  const { daily } = results;
  const share = () => {
    if (daily === null) return;
    const link = `${SITE}/daily/${daily.shareId}`;
    void Share.share({ message: link, url: link }).catch((error: unknown) => {
      console.warn("results: not shared", error);
    });
  };
  return (
    <ScrollView
      style={{ backgroundColor: c.page }}
      contentContainerStyle={styles.page}
    >
      <Stack.Screen options={{ title: results.title }} />
      <Text style={[styles.big, { color: c.ink }]}>
        {`${String(results.correct)} of ${String(results.answered)} right`}
      </Text>
      {results.points === null ? null : (
        <Text
          style={{ color: c.ink }}
        >{`${String(results.points)} points`}</Text>
      )}
      {daily === null ? null : (
        <>
          <Text style={{ color: c["ink-muted"] }}>
            {`Streak: ${String(daily.streak.days)} ${daily.streak.days === 1 ? "day" : "days"}`}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={share}
            style={[styles.pill, { borderColor: c.hairline }]}
          >
            <Text style={{ color: c.ink }}>Share</Text>
          </Pressable>
        </>
      )}
      {results.missed.length === 0 ? null : (
        <View style={styles.missed}>
          <Text style={[styles.heading, { color: c.ink }]}>Read again</Text>
          {results.missed.map((m) => (
            <Pressable
              key={`${m.itemId}.${m.momentId}`}
              accessibilityRole="link"
              onPress={() => {
                router.push(`/read/${m.itemId}?moment=${m.momentId}`);
              }}
            >
              <Text style={{ color: c.ink }}>{m.sectionTitle}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        onPress={leave}
        style={[styles.pill, { backgroundColor: c.ink }]}
      >
        <Text style={{ color: c.page }}>Done</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12 },
  big: { fontSize: type.display.size, fontWeight: type.display.weight },
  heading: { fontSize: type.section.size, fontWeight: type.section.weight },
  missed: { gap: 8 },
  pill: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "transparent",
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
});
