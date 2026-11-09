import type { ChapterEnd } from "@interval/api-client";
import { type } from "@interval/tokens";
import {
  router,
  Stack,
  useFocusEffect,
  useLocalSearchParams,
} from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useColors } from "../../../../components/theme";
import { askCheckpoint, readChapter } from "../../../../lib/books";
import { startQuiz } from "../../../../lib/quiz";

// While the checkpoint is made: asked again this often, as the web's page refreshes.
const PREPARING_MS = 3000;

// P4-W21-S04 (§5F, Q-P2-35): a chapter's end: its checkpoint, made from the chapter's
// text, worded as the web's chapter page.
export default function ChapterScreen() {
  const c = useColors();
  const params = useLocalSearchParams();
  const bookId = String(params.id ?? "");
  const chapterId = String(params.chapter ?? "");
  const [end, setEnd] = useState<ChapterEnd | "loading" | "gone" | "failed">(
    "loading",
  );
  const [reads, setReads] = useState(0);
  const [said, setSaid] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let current = true;
      void readChapter(bookId, chapterId)
        .catch((error: unknown) => {
          console.warn("chapter: not read", error);
          return { status: "failed" } as const;
        })
        .then((got) => {
          if (!current) return;
          setEnd(
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
    }, [bookId, chapterId, reads]),
  );

  const preparing =
    typeof end === "object" && end.state === "preparing" && !end.stuck;
  useEffect(() => {
    if (!preparing) return;
    const timer = setTimeout(() => {
      setReads((n) => n + 1);
    }, PREPARING_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [preparing, end]);

  if (typeof end === "string")
    return (
      <View style={[styles.page, { backgroundColor: c.page }]}>
        <Text style={{ color: c.ink }}>
          {end === "loading"
            ? "Loading…"
            : end === "gone"
              ? "This chapter isn't there."
              : "Couldn't load the chapter."}
        </Text>
      </View>
    );

  const ask = (label: string) => (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        setSaid(null);
        void askCheckpoint(bookId, chapterId)
          .catch((error: unknown) => {
            console.warn("chapter: not asked", error);
            return false;
          })
          .then((ok) => {
            if (ok) setReads((n) => n + 1);
            else setSaid("Couldn't ask for the checkpoint. Try again.");
          });
      }}
      style={[styles.pill, { backgroundColor: c.ink }]}
    >
      <Text style={{ color: c.page }}>{label}</Text>
    </Pressable>
  );
  const take = () => {
    setSaid(null);
    void startQuiz({ chapterId })
      .catch((error: unknown) => {
        console.warn("chapter: checkpoint not started", error);
        return { status: "failed" } as const;
      })
      .then((got) => {
        if (got.status === "ok") router.push(`/quiz/${got.value.attemptId}`);
        else setSaid("Couldn't start the checkpoint. Try again.");
      });
  };

  const body =
    end.state === "none" ? (
      end.finished ? (
        <>
          <Text style={{ color: c.ink }}>
            Five questions on this chapter, made from its text.
          </Text>
          {ask("Make the checkpoint")}
        </>
      ) : (
        <Text style={{ color: c.ink }}>
          Finish this chapter&apos;s sessions to take its checkpoint.
        </Text>
      )
    ) : end.state === "preparing" ? (
      end.stuck ? (
        <>
          <Text style={{ color: c.ink }}>
            This is taking longer than it should.
          </Text>
          {ask("Try again")}
        </>
      ) : (
        <Text accessibilityLiveRegion="polite" style={{ color: c.ink }}>
          Preparing your checkpoint…
        </Text>
      )
    ) : end.state === "failed" ? (
      <>
        <Text style={{ color: c.ink }}>{end.failure}</Text>
        {ask("Try again")}
      </>
    ) : (
      <>
        <Text style={{ color: c.ink }}>
          {`60 seconds · ${String(end.size)} questions · pass ${String(end.passMark)} of ${String(end.size)}`}
        </Text>
        {end.concepts.length === 0 ? null : (
          <Text style={{ color: c["ink-muted"] }}>
            {`On ${end.concepts.join(", ")}`}
          </Text>
        )}
        {end.last === null ? null : (
          <Text style={{ color: c.ink }}>
            {end.last.passed
              ? `Passed ${String(end.last.correct)} of ${String(end.last.size)}`
              : `Not yet: ${String(end.last.correct)} of ${String(end.last.size)}`}
          </Text>
        )}
        <Pressable
          accessibilityRole="button"
          onPress={take}
          style={[styles.pill, { backgroundColor: c.ink }]}
        >
          <Text style={{ color: c.page }}>
            {end.last === null ? "Take the checkpoint" : "Take it again"}
          </Text>
        </Pressable>
      </>
    );

  return (
    <ScrollView
      style={{ backgroundColor: c.page }}
      contentContainerStyle={styles.page}
    >
      <Stack.Screen options={{ title: end.bookTitle }} />
      <Text style={{ color: c["ink-muted"] }}>End of chapter</Text>
      <Text style={[styles.title, { color: c.ink }]}>{end.title}</Text>
      <Text style={[styles.heading, { color: c.ink }]}>Chapter checkpoint</Text>
      {body}
      {said === null ? null : (
        <Text accessibilityLiveRegion="polite" style={{ color: c.ink }}>
          {said}
        </Text>
      )}
      {end.next === null ? (
        <Pressable
          accessibilityRole="link"
          onPress={() => {
            router.replace("/paths");
          }}
        >
          <Text style={{ color: c.ink }}>Back to your books</Text>
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="link"
          onPress={() => {
            if (end.next !== null)
              router.replace(`/books/${bookId}?session=${end.next.sessionId}`);
          }}
        >
          <Text style={{ color: c.ink }}>{`Next: ${end.next.title} →`}</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12 },
  title: { fontSize: type.section.size, fontWeight: type.section.weight },
  heading: { fontWeight: type.section.weight },
  pill: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
});
