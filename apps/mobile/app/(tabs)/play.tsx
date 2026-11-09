import { type Game, type PlayResponse } from "@interval/api-client";
import { type } from "@interval/tokens";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useColors } from "../../components/theme";
import { readPlay, startQuiz } from "../../lib/quiz";

const GAME_TEXT: Record<Game, { title: string; about: string }> = {
  sprint: {
    title: "Sprint",
    about: "60 seconds of questions on what you've read.",
  },
  estimation: {
    title: "Estimation",
    about: "Guess the number: close counts.",
  },
  daily: { title: "Today's challenge", about: "One set for everyone, today." },
};

const LIVE = [
  ["sprint", "Live sprint", "60 seconds against another player."],
  ["fastest_finger", "Fastest finger", "First right answer takes the round."],
] as const;

// P4-W21-S01 (§6.3, OPS-3): the solo games and the daily challenge, as the web's Play,
// and live matches (P4-W21-S02).
export default function PlayScreen() {
  const c = useColors();
  const [play, setPlay] = useState<PlayResponse | "loading" | "failed">(
    "loading",
  );
  const [said, setSaid] = useState<string | null>(null);

  // Read again on each visit: a finished daily shows as played.
  useFocusEffect(
    useCallback(() => {
      let current = true;
      void readPlay()
        .catch((error: unknown) => {
          console.warn("play: not read", error);
          return { status: "failed" } as const;
        })
        .then((got) => {
          if (current) setPlay(got.status === "ok" ? got.value : "failed");
        });
      return () => {
        current = false;
      };
    }, []),
  );

  const start = (game: Game) => {
    setSaid(null);
    void startQuiz({ game })
      .catch((error: unknown) => {
        console.warn("play: not started", error);
        return { status: "failed" } as const;
      })
      .then((got) => {
        if (got.status === "ok") router.push(`/quiz/${got.value.attemptId}`);
        else
          setSaid(
            got.status === "none"
              ? game === "daily"
                ? "No challenge is set for today yet."
                : "You've played every question this week. Read more to unlock new ones."
              : got.status === "forbidden"
                ? "Your plan doesn't include this game."
                : "Couldn't start the game. Try again.",
          );
      });
  };

  if (play === "loading" || play === "failed")
    return (
      <View style={[styles.page, { backgroundColor: c.page }]}>
        <Text style={{ color: c.ink }}>
          {play === "loading" ? "Loading…" : "Couldn't load Play."}
        </Text>
      </View>
    );
  const today = play.daily.today;
  const played = typeof today === "object" && today.finished;
  return (
    <ScrollView
      style={{ backgroundColor: c.page }}
      contentContainerStyle={styles.page}
    >
      {said === null ? null : (
        <Text accessibilityLiveRegion="polite" style={{ color: c.ink }}>
          {said}
        </Text>
      )}
      {(["daily", "sprint", "estimation"] as const).map((game) => (
        <View key={game} style={[styles.card, { borderColor: c.hairline }]}>
          <Text style={[styles.title, { color: c.ink }]}>
            {GAME_TEXT[game].title}
          </Text>
          <Text style={{ color: c["ink-muted"] }}>{GAME_TEXT[game].about}</Text>
          {game === "daily" ? (
            <Text style={{ color: c["ink-muted"] }}>
              {`Streak: ${String(play.daily.streak.days)} ${play.daily.streak.days === 1 ? "day" : "days"}`}
              {played ? ` · Played: ${String(today.points)} points` : ""}
            </Text>
          ) : null}
          {!play.games[game] ? (
            <Text style={{ color: c["ink-muted"] }}>
              Not included in your plan.
            </Text>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                game === "daily" && played
                  ? "See today's results"
                  : `Play ${GAME_TEXT[game].title}`
              }
              onPress={() => {
                start(game);
              }}
              style={[styles.pill, { backgroundColor: c.ink }]}
            >
              <Text style={{ color: c.page }}>
                {game === "daily" && played ? "See results" : "Play"}
              </Text>
            </Pressable>
          )}
        </View>
      ))}
      {/* P4-W21-S02 (Q-P4-05): live 1v1, a person or, after 10 s, a ghost or bot. */}
      {LIVE.map(([mode, title, about]) => (
        <View key={mode} style={[styles.card, { borderColor: c.hairline }]}>
          <Text style={[styles.title, { color: c.ink }]}>{title}</Text>
          <Text style={{ color: c["ink-muted"] }}>{about}</Text>
          {!play.live.offered || !play.live[mode] ? (
            <Text style={{ color: c["ink-muted"] }}>
              {play.live.offered
                ? "Not included in your plan."
                : "Coming later"}
            </Text>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Play ${title}`}
              onPress={() => {
                router.push(`/live/${mode}`);
              }}
              style={[styles.pill, { backgroundColor: c.ink }]}
            >
              <Text style={{ color: c.page }}>Play</Text>
            </Pressable>
          )}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12 },
  card: { borderWidth: 1, borderRadius: 20, padding: 16, gap: 8 },
  title: { fontSize: type.section.size, fontWeight: type.section.weight },
  pill: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
});
