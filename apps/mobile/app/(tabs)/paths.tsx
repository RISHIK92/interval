import type { BooksResponse, PathsResponse } from "@interval/api-client";
import { type } from "@interval/tokens";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useColors } from "../../components/theme";
import { readBooks } from "../../lib/books";
import { readPaths, setPath } from "../../lib/paths";

type Path = PathsResponse["paths"][number];

// P4-W21-S03 (§5F, Q-P2-27): the live topic paths, the active one first; Start (or
// Resume) makes one active and pauses any other, as on the web.
export default function PathsScreen() {
  const c = useColors();
  const [list, setList] = useState<Path[] | "loading" | "setup" | "failed">(
    "loading",
  );
  const [said, setSaid] = useState<string | null>(null);
  // P4-W21-S04 (§5F): the user's own PDF books, read here in sessions.
  const [books, setBooks] = useState<BooksResponse["books"]>([]);

  const load = useCallback(() => {
    void readBooks()
      .catch((error: unknown) => {
        console.warn("books: not read", error);
        return { status: "failed" } as const;
      })
      .then((got) => {
        if (got.status === "ok") setBooks(got.value.books);
      });
    void readPaths()
      .catch((error: unknown) => {
        console.warn("paths: not read", error);
        return { status: "failed" } as const;
      })
      .then((got) => {
        setList(
          got.status === "ok"
            ? got.value.paths
            : got.status === "conflict"
              ? "setup"
              : "failed",
        );
      });
  }, []);
  // Read again on each visit: a path started or paused elsewhere shows.
  useFocusEffect(load);

  const change = (path: Path, action: "start" | "pause") => {
    setSaid(null);
    void setPath(path.pathId, action)
      .catch((error: unknown) => {
        console.warn("paths: not changed", error);
        return false;
      })
      .then((ok) => {
        if (!ok) {
          setSaid("Couldn't change the path. Try again.");
          return;
        }
        if (action === "start") router.push(`/paths/${path.pathId}`);
        else load();
      });
  };

  if (!Array.isArray(list))
    return (
      <View style={[styles.page, { backgroundColor: c.page }]}>
        <Text style={{ color: c.ink }}>
          {list === "loading"
            ? "Loading…"
            : list === "setup"
              ? "Finish setting up on the web (topics, level and break length), then come back."
              : "Couldn't load your paths."}
        </Text>
      </View>
    );
  // As the web: the active path first, the rest in their own order.
  const sorted = [
    ...list.filter((p) => p.mine === "active"),
    ...list.filter((p) => p.mine !== "active"),
  ];
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
      {sorted.length === 0 ? (
        <Text style={{ color: c["ink-muted"] }}>No paths yet.</Text>
      ) : null}
      {sorted.map((path) => (
        <View
          key={path.pathId}
          style={[styles.card, { borderColor: c.hairline }]}
        >
          <Pressable
            accessibilityRole="link"
            onPress={() => {
              router.push(`/paths/${path.pathId}`);
            }}
          >
            <Text style={[styles.title, { color: c.ink }]}>{path.name}</Text>
          </Pressable>
          {path.mine === null && !path.retired ? null : (
            <Text style={{ color: c["ink-muted"] }}>
              {path.retired
                ? "Retired"
                : path.mine === "active"
                  ? "Your active path"
                  : "Paused"}
            </Text>
          )}
          <Text style={{ color: c.ink }}>{path.why}</Text>
          <Text style={{ color: c["ink-muted"] }}>
            {`${String(path.sections)} sections · ${String(path.readings)} readings · ${String(Math.round(path.minutes))} min`}
          </Text>
          {path.retired ? null : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${path.mine === "active" ? "Pause" : path.mine === "paused" ? "Resume" : "Start"} ${path.name}`}
              onPress={() => {
                change(path, path.mine === "active" ? "pause" : "start");
              }}
              style={[styles.pill, { backgroundColor: c.ink }]}
            >
              <Text style={{ color: c.page }}>
                {path.mine === "active"
                  ? "Pause"
                  : path.mine === "paused"
                    ? "Resume"
                    : "Start"}
              </Text>
            </Pressable>
          )}
        </View>
      ))}
      {books.length === 0 ? null : (
        <Text style={[styles.title, { color: c.ink }]}>Your books</Text>
      )}
      {books.map((book) => (
        <View
          key={book.bookId}
          style={[styles.card, { borderColor: c.hairline }]}
        >
          <Text style={[styles.title, { color: c.ink }]}>{book.title}</Text>
          <Text style={{ color: c["ink-muted"] }}>
            {`${String(book.done)} of ${String(book.of)} sessions done`}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${book.next === null ? "Read again" : book.started ? "Resume" : "Start"} ${book.title}`}
            onPress={() => {
              router.push(
                `/books/${book.bookId}?session=${book.next ?? book.first}`,
              );
            }}
            style={[styles.pill, { backgroundColor: c.ink }]}
          >
            <Text style={{ color: c.page }}>
              {book.next === null
                ? "Read again"
                : book.started
                  ? "Resume"
                  : "Start"}
            </Text>
          </Pressable>
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
