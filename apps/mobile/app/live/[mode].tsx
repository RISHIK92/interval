import {
  FINGER,
  type FingerState,
  type LiveGame,
  runLive,
  SPRINT,
  type SprintState,
} from "@interval/game-client";
import { type } from "@interval/tokens";
import * as Haptics from "expo-haptics";
import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useColors } from "../../components/theme";
import { type LiveMode, transport } from "../../lib/live";

type Screen<S> =
  { kind: "queue" } | { kind: "match"; state: S } | { kind: "error" };

const OUTCOME = { won: "You won", lost: "You lost", draw: "A draw" } as const;
const TITLE: Record<LiveMode, string> = {
  sprint: "Live sprint",
  fastest_finger: "Fastest finger",
};

// The player's own count, and the opponent's: every score that isn't theirs.
function score(totals: Record<string, number>, you: string | null) {
  const mine = you === null ? 0 : (totals[you] ?? 0);
  const theirs = Object.entries(totals)
    .filter(([player]) => player !== you)
    .reduce((sum, [, n]) => sum + n, 0);
  return { mine, theirs };
}

function useSecondsLeft(endsAt: number): number {
  const left = () => Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
  const [seconds, setSeconds] = useState(left);
  useEffect(() => {
    const tick = () => {
      setSeconds(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => {
      clearInterval(timer);
    };
  }, [endsAt]);
  return seconds;
}

// P4-W21-S02 (§6.3, Q-P4-05, ADR-0033): a live 1v1 in the app, on the protocol client the
// web uses (@interval/game-client): the queue, a ghost or bot after 10 s (C-01, BOT-3),
// the match on the game server's socket, and Play again. Leaving the app counts as a
// focus switch, as a hidden tab does on the web (§6.9).
export default function LiveScreen() {
  const param = String(useLocalSearchParams().mode ?? "");
  const mode: LiveMode | null =
    param === "sprint" || param === "fastest_finger" ? param : null;
  if (mode === null) return null;
  return mode === "sprint" ? (
    <Live
      mode="sprint"
      rules={SPRINT}
      current={sprintCurrent}
      View={SprintView}
    />
  ) : (
    <Live
      mode="fastest_finger"
      rules={FINGER}
      current={fingerCurrent}
      View={FingerView}
    />
  );
}

// The question in play, if any: a new one takes answers again.
const sprintCurrent = (state: SprintState) =>
  state.phase === "playing" ? (state.question?.n ?? null) : null;
const fingerCurrent = (state: FingerState) =>
  state.phase === "round" ? state.n : null;

type ViewProps<S> = {
  state: S;
  answered: number | null;
  onAnswer: (n: number, choice: number) => void;
};

function Live<S>({
  mode,
  rules,
  current,
  View: MatchView,
}: {
  mode: LiveMode;
  rules: LiveGame<S>;
  current: (state: S) => number | null;
  View: (props: ViewProps<S>) => ReactNode;
}) {
  const c = useColors();
  const [screen, setScreen] = useState<Screen<S>>({ kind: "queue" });
  const [answered, setAnswered] = useState<number | null>(null);
  const [opponent, setOpponent] = useState<string | null>(null);
  const [noFallback, setNoFallback] = useState(false);
  const [game, setGame] = useState(0);
  const live = useRef<ReturnType<typeof runLive> | null>(null);

  useEffect(() => {
    const run = runLive<S>({
      game: rules,
      ...transport(mode),
      wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: Date.now,
      onState: (state) => {
        setAnswered((n) => (n === current(state) ? n : null));
        setScreen({ kind: "match", state });
      },
      onError: () => {
        setScreen({ kind: "error" });
      },
      onNoFallback: () => {
        setNoFallback(true);
      },
      onOpponent: setOpponent,
    });
    live.current = run;
    const watch = AppState.addEventListener("change", (next) => {
      if (next !== "active") run.focusLost();
    });
    return () => {
      watch.remove();
      run.stop();
      live.current = null;
    };
  }, [game, mode, rules, current]);

  const again = () => {
    setAnswered(null);
    setOpponent(null);
    setNoFallback(false);
    setScreen({ kind: "queue" });
    setGame((n) => n + 1);
  };
  const finished = screen.kind === "match" && rules.over(screen.state);

  return (
    <ScrollView
      style={{ backgroundColor: c.page }}
      contentContainerStyle={styles.page}
    >
      <Stack.Screen options={{ title: TITLE[mode] }} />
      {screen.kind === "queue" ? (
        <View accessibilityLiveRegion="polite" style={styles.block}>
          <Text style={[styles.big, { color: c.ink }]}>
            Finding an opponent…
          </Text>
          {noFallback ? (
            <Text style={{ color: c["ink-muted"] }}>
              No one to play right now. Still looking.
            </Text>
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                live.current?.fallback();
              }}
              style={[styles.pill, { borderColor: c.hairline }]}
            >
              <Text style={{ color: c.ink }}>Play bot now</Text>
            </Pressable>
          )}
        </View>
      ) : screen.kind === "error" ? (
        <Text style={{ color: c.ink }}>
          The match couldn&apos;t go on. Try again.
        </Text>
      ) : (
        <>
          {/* BOT-3: a ghost or bot says so for the whole match. */}
          {opponent === null ? null : (
            <Text
              style={{ color: c["ink-muted"] }}
            >{`Playing ${opponent}`}</Text>
          )}
          <MatchView
            state={screen.state}
            answered={answered}
            onAnswer={(n, choice) => {
              if (live.current?.answer(n, choice) === true) setAnswered(n);
            }}
          />
        </>
      )}
      {finished || screen.kind === "error" ? (
        <Pressable
          accessibilityRole="button"
          onPress={again}
          style={[styles.pill, { backgroundColor: c.ink }]}
        >
          <Text style={{ color: c.page }}>Play again</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

function Options({
  options,
  disabled,
  mark,
  onPick,
}: {
  options: string[];
  disabled: boolean;
  mark?: (i: number) => string;
  onPick: (i: number) => void;
}) {
  const c = useColors();
  return options.map((option, i) => (
    <Pressable
      key={i}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        onPick(i);
      }}
      style={[styles.option, { borderColor: c.hairline }]}
    >
      <Text style={{ color: c.ink }}>{`${option}${mark?.(i) ?? ""}`}</Text>
    </Pressable>
  ));
}

function AiDrafted() {
  const c = useColors();
  return (
    <Text
      style={[styles.tag, { backgroundColor: c.well, color: c["ink-muted"] }]}
    >
      AI-drafted
    </Text>
  );
}

function Clock({ endsAt }: { endsAt: number }) {
  const c = useColors();
  const seconds = useSecondsLeft(endsAt);
  return (
    <Text
      accessibilityLabel={`${String(seconds)} seconds left`}
      style={{ color: c.ink }}
    >
      {`${String(seconds)}s`}
    </Text>
  );
}

function Final({
  outcome,
  totals,
  you,
  abandoned,
  unit,
}: {
  outcome: keyof typeof OUTCOME;
  totals: Record<string, number>;
  you: string | null;
  abandoned: string[];
  unit: string;
}) {
  const c = useColors();
  const { mine, theirs } = score(totals, you);
  return (
    <View style={styles.block}>
      <Text style={[styles.big, { color: c.ink }]}>{OUTCOME[outcome]}</Text>
      {abandoned.some((p) => p !== you) ? (
        <Text style={{ color: c["ink-muted"] }}>
          Your opponent left the match.
        </Text>
      ) : null}
      <Text style={{ color: c.ink }}>
        {`${unit}: you ${String(mine)} · opponent ${String(theirs)}`}
      </Text>
    </View>
  );
}

const CANCELLED = "Your opponent didn't join, so the match was cancelled.";

// P3-W16-S04 (Q-P3-23), as the web's SprintView: right and wrong carry an icon and a word,
// never color alone; each is felt too (P4-W21-S01).
function SprintView({ state, answered, onAnswer }: ViewProps<SprintState>) {
  const c = useColors();
  const last = state.phase === "playing" ? state.last : null;
  const lastKey =
    last === null ? null : `${String(last.n)}.${String(last.correct)}`;
  useEffect(() => {
    if (last === null) return;
    void Haptics.notificationAsync(
      last.correct
        ? Haptics.NotificationFeedbackType.Success
        : Haptics.NotificationFeedbackType.Error,
    ).catch((error: unknown) => {
      console.warn("live: no haptic", error);
    });
    // Once per judged answer (its key), not on every render.
  }, [lastKey]);
  if (state.phase === "connecting")
    return <Text style={{ color: c.ink }}>Opponent found. Connecting…</Text>;
  if (state.phase === "cancelled")
    return <Text style={{ color: c.ink }}>{CANCELLED}</Text>;
  if (state.phase === "countdown")
    return (
      <View style={styles.block}>
        <Text style={{ color: c["ink-muted"] }}>Get ready</Text>
        <Clock endsAt={state.endsAt} />
      </View>
    );
  if (state.phase === "final")
    return (
      <View style={styles.block}>
        <Final
          outcome={state.outcome}
          totals={state.totals}
          you={state.you}
          abandoned={state.abandoned}
          unit="Correct"
        />
        {state.questions.map((q) => (
          <Text key={q.n} style={{ color: c.ink }}>
            {`${q.stem} — ${q.options[q.correct] ?? ""}${
              q.chosen === null
                ? " · Not answered"
                : q.chosen === q.correct
                  ? " · ✓"
                  : " · ✗"
            }`}
          </Text>
        ))}
      </View>
    );
  const { question } = state;
  const { mine, theirs } = score(state.scores, state.you);
  return (
    <View style={styles.block}>
      <View style={styles.row}>
        <Text style={{ color: c.ink }}>
          {`You ${String(mine)} · Opponent ${String(theirs)}`}
        </Text>
        <Clock endsAt={state.endsAt} />
      </View>
      {last === null ? null : (
        <Text accessibilityLiveRegion="polite" style={{ color: c.ink }}>
          {last.correct ? "✓ Right" : "✗ Wrong"}
        </Text>
      )}
      {question === null ? (
        <Text style={{ color: c.ink }}>
          You&apos;ve answered every question. Waiting for the clock.
        </Text>
      ) : (
        <>
          {question.ai ? <AiDrafted /> : null}
          <Text style={[styles.stem, { color: c.ink }]}>{question.stem}</Text>
          <Options
            options={question.options}
            disabled={answered === question.n}
            onPick={(i) => {
              onAnswer(question.n, i);
            }}
          />
        </>
      )}
    </View>
  );
}

// P3-W16-S05 (Q-P3-24), as the web's FingerView: locks and the opponent's status carry an
// icon and a word.
function FingerView({ state, answered, onAnswer }: ViewProps<FingerState>) {
  const c = useColors();
  if (state.phase === "cancelled")
    return <Text style={{ color: c.ink }}>{CANCELLED}</Text>;
  if (state.phase === "final")
    return (
      <Final
        outcome={state.outcome}
        totals={state.totals}
        you={state.you}
        abandoned={state.abandoned}
        unit="Rounds taken"
      />
    );
  if (state.phase === "connecting")
    return <Text style={{ color: c.ink }}>Opponent found. Connecting…</Text>;
  if (state.phase === "countdown")
    return (
      <View style={styles.block}>
        <Text style={{ color: c["ink-muted"] }}>Get ready</Text>
        <Clock endsAt={state.endsAt} />
      </View>
    );
  const { mine, theirs } = score(state.totals, state.you);
  const header = (
    <Text style={{ color: c.ink }}>
      {`Rounds taken: you ${String(mine)} · opponent ${String(theirs)}`}
    </Text>
  );
  if (state.phase === "waiting")
    return (
      <View style={styles.block}>
        {header}
        <Text style={{ color: c.ink }}>
          Back in the match. The next round is coming…
        </Text>
      </View>
    );
  if (state.phase === "reveal") {
    const took =
      state.taken === ""
        ? "Nobody took this round"
        : state.taken === state.you
          ? "✓ You took this round"
          : "✗ Your opponent took this round";
    return (
      <View style={styles.block}>
        {header}
        <Text accessibilityLiveRegion="polite" style={{ color: c.ink }}>
          {took}
        </Text>
        {state.ai ? <AiDrafted /> : null}
        <Text style={[styles.stem, { color: c.ink }]}>{state.stem}</Text>
        <Options
          options={state.options}
          disabled
          mark={(i) => (i === state.correct ? " ✓" : "")}
          onPick={() => undefined}
        />
      </View>
    );
  }
  const you = state.you;
  const lockedIn =
    answered === state.n ||
    (you !== null && state.locked.players.includes(you));
  const opponentLocked = state.locked.players.some((p) => p !== you);
  return (
    <View style={styles.block}>
      {header}
      <View style={styles.row}>
        <Text style={{ color: c.ink }}>{`Round ${String(state.n)}`}</Text>
        <Clock endsAt={state.endsAt} />
      </View>
      <Text style={{ color: c["ink-muted"] }}>
        {`${lockedIn ? "🔒 You: locked in" : "You: choose an answer"} · ${
          opponentLocked ? "🔒 Opponent: locked in" : "⏳ Opponent: thinking"
        }`}
      </Text>
      {state.ai ? <AiDrafted /> : null}
      <Text style={[styles.stem, { color: c.ink }]}>{state.stem}</Text>
      <Options
        options={state.options}
        disabled={lockedIn}
        onPick={(i) => {
          onAnswer(state.n, i);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12 },
  block: { gap: 10 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  big: { fontSize: type.section.size, fontWeight: type.section.weight },
  stem: { fontSize: 18, fontWeight: "600" },
  option: { borderWidth: 1, borderRadius: 14, padding: 14 },
  tag: {
    alignSelf: "flex-start",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontSize: 12,
    fontWeight: "600",
  },
  pill: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "transparent",
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
});
