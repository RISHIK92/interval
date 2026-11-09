import type { BoardResponse } from "@interval/api-client";
import { type } from "@interval/tokens";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useColors } from "../components/theme";
import { readBoard } from "../lib/boards";

const NOT_YET = "You're not on this board yet: play to join it.";
// Owner, 2026-11-09: these are set on the web's Profile for now.
const UNSET = {
  country: "Set your country on Profile on the web to see its board.",
  university: "Set your university on Profile on the web to see its board.",
  follows: "Follow people on Profile on the web to see them here.",
} as const;
const MISSING = {
  not_yet: NOT_YET,
  set_university:
    "Set your university on Profile on the web to see where it stands.",
  university_absent:
    "Your university isn't on this board yet: its players haven't played.",
} as const;

// P4-W21-S03 (§6.7; wireframe 15): the boards, as the web's: a game, a scope and a
// period; the top 50 with the player's own row marked and pinned below.
export default function BoardsScreen() {
  const c = useColors();
  const [query, setQuery] = useState({
    game: "daily",
    scope: "global",
    period: "current",
  });
  // The last board read stays on screen while another loads, or if it fails.
  const [board, setBoard] = useState<BoardResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "setup" | "failed">(
    "loading",
  );
  const [tries, setTries] = useState(0);

  useEffect(() => {
    let current = true;
    setStatus("loading");
    void readBoard(query)
      .catch((error: unknown) => {
        console.warn("boards: not read", error);
        return { status: "failed" } as const;
      })
      .then((got) => {
        if (!current) return;
        if (got.status === "ok") setBoard(got.value);
        setStatus(
          got.status === "ok"
            ? "ok"
            : got.status === "conflict"
              ? "setup"
              : "failed",
        );
      });
    return () => {
      current = false;
    };
  }, [query, tries]);

  const retry = (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        setTries((n) => n + 1);
      }}
      style={[styles.chip, { borderColor: c.hairline }]}
    >
      <Text style={{ color: c.ink }}>Try again</Text>
    </Pressable>
  );
  if (board === null || status === "setup")
    return (
      <View style={[styles.page, { backgroundColor: c.page }]}>
        <Text style={{ color: c.ink }}>
          {status === "loading"
            ? "Loading…"
            : status === "setup"
              ? "Pick a username on the web, then come back."
              : "Couldn't load the board."}
        </Text>
        {status === "failed" ? retry : null}
      </View>
    );

  const chips = (
    label: string,
    key: "game" | "scope" | "period",
    options: { key: string; label: string }[],
  ) => (
    <View accessibilityLabel={label} style={styles.chips}>
      {options.map((o) => {
        const on = board[key] === o.key;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => {
              setQuery({ ...query, [key]: o.key });
            }}
            style={[
              styles.chip,
              { borderColor: c.hairline, backgroundColor: on ? c.ink : c.page },
            ]}
          >
            <Text style={{ color: on ? c.page : c.ink }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
  const { body } = board;
  return (
    <ScrollView
      style={{ backgroundColor: c.page }}
      contentContainerStyle={styles.page}
    >
      {chips("Game", "game", board.games)}
      {chips("Board", "scope", board.scopes)}
      {chips("When", "period", board.periods)}
      {status === "failed" ? (
        <View style={styles.block}>
          <Text accessibilityLiveRegion="polite" style={{ color: c.ink }}>
            Couldn&apos;t load that board.
          </Text>
          {retry}
        </View>
      ) : null}
      {body.kind === "unset" ? (
        <Text style={{ color: c["ink-muted"] }}>{UNSET[body.what]}</Text>
      ) : (
        <View style={styles.block}>
          <Text style={{ color: c["ink-muted"] }}>{body.unit}</Text>
          {body.rows.length === 0 ? (
            <Text style={{ color: c["ink-muted"] }}>
              Nobody on this board yet.
            </Text>
          ) : (
            body.rows.map((row) => (
              <View
                key={row.id}
                accessibilityLabel={`#${String(row.rank)} ${row.name}${row.id === body.mine ? `, ${body.mark}` : ""}, ${row.score}`}
                style={[styles.row, { borderColor: c.hairline }]}
              >
                <Text
                  style={{ color: c["ink-muted"] }}
                >{`#${String(row.rank)}`}</Text>
                <Text style={[styles.name, { color: c.ink }]}>
                  {row.id === body.mine
                    ? `${row.name} · ${body.mark}`
                    : row.name}
                </Text>
                <Text style={{ color: c.ink }}>{row.score}</Text>
              </View>
            ))
          )}
          {body.pinned !== null ? (
            <View style={[styles.pinned, { backgroundColor: c.well }]}>
              <Text style={{ color: c.ink }}>
                {`${body.mark}: ${body.pinned.name} · ${body.pinned.score} · ${body.pinned.note}`}
              </Text>
            </View>
          ) : body.missing === null ? null : (
            <Text style={{ color: c["ink-muted"] }}>
              {MISSING[body.missing]}
            </Text>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12 },
  block: { gap: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  row: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    borderBottomWidth: 1,
    paddingVertical: 8,
  },
  name: { flex: 1, fontWeight: type.section.weight },
  pinned: { borderRadius: 12, padding: 12 },
});
