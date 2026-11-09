import { type BookReading, placeKeeper } from "@interval/api-client";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Pdf from "react-native-pdf";
import { useColors } from "../../../components/theme";
import {
  discardBook,
  downloadBook,
  finishSession,
  openingPage,
  readSession,
  savePlace,
} from "../../../lib/books";

// As the web's reader: the place is saved a second after the pages settle, and on leaving.
const SETTLE_MS = 1000;

// P4-W21-S04 (§5F, Q-P2-31, DB-6): a book session in the app: the PDF opened at its place,
// the place kept, Mark done, and the way on. The file is fetched for this open only and
// deleted when the reader closes. The whole PDF can be scrolled; outside the session's
// pages a line says so, and the place isn't kept there (owner, 2026-11-09).
export default function BookScreen() {
  const c = useColors();
  const params = useLocalSearchParams();
  const bookId = String(params.id ?? "");
  const session = typeof params.session === "string" ? params.session : null;
  const [reading, setReading] = useState<
    BookReading | "loading" | "gone" | "failed"
  >("loading");
  const [file, setFile] = useState<
    | { status: "loading" }
    | { status: "failed" }
    | { status: "ready"; path: string }
  >({ status: "loading" });
  const [page, setPage] = useState<number | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    setReading("loading");
    setSaid(null);
    setPage(null);
    void readSession(bookId, session)
      .catch((error: unknown) => {
        console.warn("book: not read", error);
        return { status: "failed" } as const;
      })
      .then((got) => {
        if (!current) return;
        setReading(
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
  }, [bookId, session]);

  // The file once per book open; removed when the screen closes, whatever happened.
  useEffect(() => {
    let current = true;
    let path: string | null = null;
    const download = downloadBook(bookId);
    void download.file
      .then((saved) => {
        path = saved;
        if (current) setFile({ status: "ready", path: saved });
        else void discardBook(saved);
      })
      .catch((error: unknown) => {
        if (!current) return;
        console.warn("book: file not fetched", error);
        setFile({ status: "failed" });
      });
    return () => {
      current = false;
      download.cancel();
      if (path !== null) void discardBook(path);
    };
  }, [bookId]);

  // The place: kept only once the reader has moved within this session's pages (owner,
  // 2026-10-28: opening a session never moves it), saved as the web saves it.
  const shown = typeof reading === "object" ? reading : null;
  const keeper = useRef<ReturnType<typeof placeKeeper> | null>(null);
  // Set when the view first reaches the session's opening page: reports before that,
  // and that one, are the view opening, not the reader moving.
  const arrived = useRef(false);
  useEffect(() => {
    if (shown === null) return;
    const keep = placeKeeper({
      save: (fraction) => {
        void savePlace(shown.bookId, shown.sessionId, fraction).catch(
          (error: unknown) => {
            console.warn("book: place not kept", error);
          },
        );
      },
      settleMs: SETTLE_MS,
      schedule: (run, ms) => setTimeout(run, ms),
      cancel: (timer) => {
        clearTimeout(timer);
      },
    });
    keeper.current = keep;
    arrived.current = false;
    return () => {
      keep.leaving();
      keeper.current = null;
    };
  }, [shown]);

  if (shown === null)
    return (
      <View style={[styles.page, styles.pad, { backgroundColor: c.page }]}>
        <Text style={{ color: c.ink }}>
          {reading === "loading"
            ? "Loading…"
            : reading === "gone"
              ? "This book isn't ready to read."
              : "Couldn't open this book."}
        </Text>
      </View>
    );

  const start = openingPage(shown);
  const pages =
    shown.firstPage === shown.lastPage
      ? `page ${String(shown.firstPage)}`
      : `pages ${String(shown.firstPage)}–${String(shown.lastPage)}`;
  const open = (next: string) => {
    router.setParams({ session: next });
  };
  const done = () => {
    if (busy) return;
    setBusy(true);
    setSaid(null);
    void finishSession(shown.bookId, shown.sessionId)
      .catch((error: unknown) => {
        console.warn("book: not finished", error);
        return { status: "failed" } as const;
      })
      .then((got) => {
        setBusy(false);
        if (got.status !== "ok") {
          setSaid("Couldn't mark this session done. Try again.");
          return;
        }
        // S06: the chapter's last session: its end says when the checkpoint is ready.
        if (got.value.chapterDone !== null)
          router.replace(
            `/books/${shown.bookId}/checkpoint/${got.value.chapterDone}`,
          );
        else if (shown.next !== null) open(shown.next);
        else router.back();
      });
  };
  const edge =
    page === null
      ? null
      : page > shown.lastPage
        ? shown.next === null
          ? "Past this session: Mark done to finish the book."
          : "Past this session: Mark done, or Next for the next one."
        : page < shown.firstPage
          ? "Before this session."
          : null;

  return (
    <View style={[styles.page, { backgroundColor: c.page }]}>
      <Stack.Screen options={{ title: shown.bookTitle }} />
      <View style={[styles.pad, styles.head]}>
        <Text style={{ color: c.ink }}>{shown.chapterTitle}</Text>
        <Text style={{ color: c["ink-muted"] }}>
          {`Session ${String(shown.place)} of ${String(shown.of)} · ${pages} · ${String(shown.minutes)} min${shown.finished ? " · Finished" : ""}`}
        </Text>
      </View>
      <View style={styles.page}>
        {file.status === "loading" ? (
          <Text style={[styles.pad, { color: c["ink-muted"] }]}>
            Loading the book…
          </Text>
        ) : file.status === "failed" ? (
          <Text style={[styles.pad, { color: c.ink }]}>
            Couldn&apos;t load the book&apos;s file.
          </Text>
        ) : (
          <Pdf
            key={shown.sessionId}
            source={{ uri: `file://${file.path}` }}
            page={start}
            style={styles.page}
            onPageChanged={(now) => {
              setPage(now);
              if (!arrived.current) {
                if (now === start) arrived.current = true;
                return;
              }
              if (now < shown.firstPage || now > shown.lastPage) return;
              const span = Math.max(1, shown.lastPage - shown.firstPage);
              keeper.current?.scrolled((now - shown.firstPage) / span);
            }}
            onError={(error) => {
              console.warn("book: not shown", error);
              setFile({ status: "failed" });
            }}
          />
        )}
      </View>
      {edge === null && said === null ? null : (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.pad, { color: c.ink }]}
        >
          {said ?? edge}
        </Text>
      )}
      <View style={[styles.pad, styles.row, { borderColor: c.hairline }]}>
        {shown.previous === null ? null : (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              if (shown.previous !== null) open(shown.previous);
            }}
            style={[styles.pill, { borderColor: c.hairline }]}
          >
            <Text style={{ color: c.ink }}>← Previous</Text>
          </Pressable>
        )}
        {shown.finished ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={done}
            style={[styles.pill, { backgroundColor: c.ink }]}
          >
            <Text style={{ color: c.page }}>Mark done</Text>
          </Pressable>
        )}
        {shown.next === null ? null : (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              if (shown.next !== null) open(shown.next);
            }}
            style={[styles.pill, { borderColor: c.hairline }]}
          >
            <Text style={{ color: c.ink }}>Next →</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  pad: { paddingHorizontal: 16, paddingVertical: 8 },
  head: { gap: 2 },
  row: {
    flexDirection: "row",
    gap: 8,
    borderTopWidth: 1,
    justifyContent: "space-between",
  },
  pill: {
    borderWidth: 1,
    borderColor: "transparent",
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
});
