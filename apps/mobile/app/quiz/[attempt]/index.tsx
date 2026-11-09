import type { AnswerResult, QuizView } from "@interval/api-client";
import { missed, points } from "@interval/scoring";
import { type } from "@interval/tokens";
import * as Haptics from "expo-haptics";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useColors } from "../../../components/theme";
import { answerQuiz, finishQuiz, readQuiz } from "../../../lib/quiz";

type State =
  | { status: "loading" }
  | { status: "ok"; view: QuizView; deadline: number | null }
  | { status: "failed" };

// A right or wrong answer is felt as well as seen (P4-W21-S01); never in the way.
function feel(right: boolean) {
  void Haptics.notificationAsync(
    right
      ? Haptics.NotificationFeedbackType.Success
      : Haptics.NotificationFeedbackType.Error,
  ).catch((error: unknown) => {
    console.warn("quiz: no haptic", error);
  });
}

// P4-W21-S01 (§6.3, Q-P2-14, C-27): one question at a time, served and checked by the
// server, whose clock this counts down. A model-drafted question says so (ADR-0037).
export default function QuizScreen() {
  const c = useColors();
  const attempt = String(useLocalSearchParams().attempt ?? "");
  const [state, setState] = useState<State>({ status: "loading" });
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [guess, setGuess] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  // Answers that arrive after the screen has gone (results shown, or left) change nothing.
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const finishing = useRef(false);

  // Over (no more questions, the time, or a late answer): the server finishes it, then
  // the results show. Only here: showing results never finishes an attempt.
  const results = useCallback(() => {
    if (finishing.current) return;
    finishing.current = true;
    void finishQuiz(attempt)
      .catch((error: unknown) => {
        console.warn("quiz: not finished", error);
        return { status: "failed" } as const;
      })
      .then((got) => {
        if (!mounted.current) return;
        if (got.status === "ok") router.replace(`/quiz/${attempt}/results`);
        else {
          finishing.current = false;
          setSaid("Couldn't finish the quiz. Try again.");
        }
      });
  }, [attempt]);

  const load = useCallback(() => {
    setState({ status: "loading" });
    setResult(null);
    setChosen(null);
    setGuess("");
    setSaid(null);
    void readQuiz(attempt)
      .catch((error: unknown) => {
        console.warn("quiz: not read", error);
        return { status: "failed" } as const;
      })
      .then((got) => {
        if (!mounted.current) return;
        if (got.status !== "ok") {
          setState({ status: "failed" });
          return;
        }
        // Over: no more questions, or the time is up.
        if (got.value.question === null) {
          results();
          return;
        }
        setState({
          status: "ok",
          view: got.value,
          deadline:
            got.value.secondsLeft === null
              ? null
              : Date.now() + got.value.secondsLeft * 1000,
        });
      });
  }, [attempt, results]);

  useEffect(() => {
    load();
  }, [load]);

  const deadline = state.status === "ok" ? state.deadline : null;
  useEffect(() => {
    if (deadline === null) return;
    const tick = setInterval(() => {
      setNow(Date.now());
    }, 250);
    return () => {
      clearInterval(tick);
    };
  }, [deadline]);
  const left =
    deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / 1000));
  // The server decides; at zero the results ask it (an answer in its grace still counts).
  useEffect(() => {
    if (left === 0 && result === null && !busy) results();
  }, [left, result, busy, results]);

  if (state.status !== "ok")
    return (
      <View style={[styles.page, { backgroundColor: c.page }]}>
        <Stack.Screen options={{ title: "" }} />
        <Text style={{ color: c.ink }}>
          {state.status === "loading" ? "Loading…" : "Couldn't load the quiz."}
        </Text>
        {said === null && state.status === "loading" ? null : (
          <>
            {said === null ? null : (
              <Text style={{ color: c.ink }}>{said}</Text>
            )}
            <Pressable
              accessibilityRole="button"
              onPress={load}
              style={[styles.pill, { backgroundColor: c.ink }]}
            >
              <Text style={{ color: c.page }}>Try again</Text>
            </Pressable>
          </>
        )}
      </View>
    );
  const { view } = state;
  const question = view.question;
  if (question === null) return null;

  const send = (body: { chosen: number } | { guess: number }) => {
    setBusy(true);
    void answerQuiz(attempt, { questionId: question.questionId, ...body })
      .catch((error: unknown) => {
        console.warn("quiz: answer not sent", error);
        return { status: "failed" } as const;
      })
      .then((got) => {
        if (!mounted.current) return;
        setBusy(false);
        // Too late for the clock: the results say what counted.
        if (got.status === "conflict") {
          results();
          return;
        }
        // Not this attempt's open question any more (answered elsewhere): read again.
        if (got.status === "none") {
          load();
          return;
        }
        if (got.status !== "ok") {
          setChosen(null);
          setSaid("Couldn't send your answer. Try again.");
          return;
        }
        setResult(got.value);
        feel(
          got.value.kind === "choice"
            ? got.value.correct
            : !missed(got.value.score),
        );
      });
  };

  const number = Number(guess.replace(",", "."));
  return (
    <ScrollView
      style={{ backgroundColor: c.page }}
      contentContainerStyle={styles.page}
    >
      <Stack.Screen options={{ title: view.title }} />
      {left === null ? null : (
        <Text
          accessibilityLabel={`${String(left)} seconds left`}
          style={[styles.clock, { color: c.ink }]}
        >
          {`0:${String(left).padStart(2, "0")}`}
        </Text>
      )}
      {question.aiDrafted ? (
        <Text
          style={[
            styles.tag,
            { backgroundColor: c.well, color: c["ink-muted"] },
          ]}
        >
          AI-drafted
        </Text>
      ) : null}
      <Text style={[styles.stem, { color: c.ink }]}>{question.stem}</Text>
      {question.kind === "choice" ? (
        question.options.map((option, i) => {
          const shown = result?.kind === "choice" ? result : null;
          const mark =
            shown === null
              ? ""
              : i === shown.correctOption
                ? " ✓"
                : i === chosen
                  ? " ✗"
                  : "";
          return (
            <Pressable
              key={i}
              accessibilityRole="button"
              accessibilityState={{
                disabled: result !== null || busy,
                selected: i === chosen,
              }}
              disabled={result !== null || busy}
              onPress={() => {
                setChosen(i);
                send({ chosen: i });
              }}
              style={[
                styles.option,
                {
                  borderColor:
                    shown !== null && i === shown.correctOption
                      ? c.ink
                      : c.hairline,
                },
              ]}
            >
              <Text style={{ color: c.ink }}>{`${option}${mark}`}</Text>
            </Pressable>
          );
        })
      ) : (
        <View style={styles.row}>
          <TextInput
            accessibilityLabel={`Your estimate, in ${question.unit}`}
            keyboardType="decimal-pad"
            editable={result === null && !busy}
            value={guess}
            onChangeText={setGuess}
            style={[styles.input, { color: c.ink, borderColor: c.hairline }]}
          />
          <Text style={{ color: c["ink-muted"] }}>{question.unit}</Text>
          <Pressable
            accessibilityRole="button"
            disabled={result !== null || busy || !(number > 0)}
            onPress={() => {
              send({ guess: number });
            }}
            style={[styles.pill, { backgroundColor: c.ink }]}
          >
            <Text style={{ color: c.page }}>Guess</Text>
          </Pressable>
        </View>
      )}
      {said === null ? null : (
        <Text accessibilityLiveRegion="polite" style={{ color: c.ink }}>
          {said}
        </Text>
      )}
      {result === null ? null : (
        <View accessibilityLiveRegion="polite" style={styles.reveal}>
          {result.kind === "choice" ? (
            <Text style={[styles.verdict, { color: c.ink }]}>
              {result.correct ? "Right" : "Wrong"}
            </Text>
          ) : (
            <>
              <Text style={[styles.verdict, { color: c.ink }]}>
                {`${String(result.answer)} ${result.unit} · ${String(points(result.score))} points`}
              </Text>
              {result.source === null ? null : result.source.kind ===
                "section" ? (
                <Pressable
                  accessibilityRole="link"
                  onPress={() => {
                    if (result.source?.kind === "section")
                      router.push(
                        `/read/${result.source.itemId}?moment=${result.source.momentId}`,
                      );
                  }}
                >
                  <Text style={{ color: c.ink }}>
                    {`From: ${result.source.sectionTitle}`}
                  </Text>
                </Pressable>
              ) : (
                <Pressable
                  accessibilityRole="link"
                  onPress={() => {
                    if (result.source?.kind === "page")
                      void Linking.openURL(result.source.url).catch(
                        (error: unknown) => {
                          console.warn("quiz: source not opened", error);
                        },
                      );
                  }}
                >
                  <Text style={{ color: c.ink }}>
                    {`From ${result.source.title}: “${result.source.citation}”`}
                  </Text>
                </Pressable>
              )}
            </>
          )}
          <Pressable
            accessibilityRole="button"
            onPress={load}
            style={[styles.pill, { backgroundColor: c.ink }]}
          >
            <Text style={{ color: c.page }}>Next</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12 },
  clock: { fontSize: 24, fontWeight: "600", alignSelf: "flex-end" },
  tag: {
    alignSelf: "flex-start",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontSize: 12,
    fontWeight: "600",
  },
  stem: { fontSize: type.section.size, fontWeight: type.section.weight },
  option: { borderWidth: 1, borderRadius: 14, padding: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  reveal: { gap: 10 },
  verdict: { fontSize: 18, fontWeight: "600" },
  pill: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
});
