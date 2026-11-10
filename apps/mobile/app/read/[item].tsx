import {
  CHIPS,
  type Chip,
  NOTE_MAX,
  type ReaderResponse,
} from "@interval/api-client";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { WebView } from "react-native-webview";
import { useColors } from "../../components/theme";
import { sendControl } from "../../lib/feed";
import { listen } from "../../lib/listen";
import { startQuiz } from "../../lib/quiz";
import { progressScript } from "../../lib/progress-script";
import {
  markDone,
  readPage,
  recordOutbound,
  writeNote,
} from "../../lib/reader";

// ADR-0018: without a load by then the page may be blank, so the browser is offered.
const STUCK_MS = 6000;
// P4-W20-S03 (§5D, owner 2026-11-09): a section is read through once the screen's bottom
// has passed 90% of it and the reader has been open half its minutes, 30 s at least.
const READ_THROUGH = 0.9;
const TIME_SHARE = 0.5;
const MIN_SECONDS = 30;
// A failed automatic finish is tried again after this.
const RETRY_MS = 15_000;

type State =
  | { status: "loading" }
  | { status: "ok"; page: ReaderResponse }
  | { status: "gone" | "failed" };

const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;
const isChip = (value: string | undefined): value is Chip =>
  CHIPS.some((chip) => chip === value);

const leave = () => {
  if (router.canGoBack()) router.back();
  else router.replace("/");
};

// P4-W20-S02 (ADR-0018, §3.2, ING-2): the publisher's live page, never a copy, with
// Interval's header above and its row below, as the web reader. The card's why stays on
// the card (owner, 2026-11-09).
export default function ReaderScreen() {
  const c = useColors();
  const params = useLocalSearchParams();
  const item = one(params.item) ?? "";
  const moment = one(params.moment);
  const chipParam = one(params.chip);
  const chip = isChip(chipParam) ? chipParam : undefined;
  const pos = chip === undefined ? undefined : one(params.pos);
  const path = chip === undefined ? one(params.path) : undefined;
  const [state, setState] = useState<State>({ status: "loading" });
  // ADR-0018: "stalled" offers the browser below the page; a late load clears it,
  // a failed one ("broken") doesn't. Either can be dismissed.
  const [phase, setPhase] = useState<"loading" | "done" | "stalled" | "broken">(
    "loading",
  );
  const [saved, setSaved] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [noteStatus, setNoteStatus] = useState<string | null>(null);
  const [rowStatus, setRowStatus] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setState({ status: "loading" });
    setPhase("loading");
    setNoteOpen(false);
    setNoteStatus(null);
    setRowStatus(null);
    void readPage(item, {
      ...(moment === undefined ? {} : { moment }),
      ...(chip === undefined ? {} : { chip }),
      ...(pos === undefined ? {} : { pos }),
      ...(path === undefined ? {} : { path }),
    })
      .catch((error: unknown) => {
        console.warn("reader: not read", error);
        return { status: "failed" } as const;
      })
      .then((loaded) => {
        if (!current) return;
        setState(loaded);
        if (loaded.status === "ok") {
          setSaved(loaded.page.saved);
          setNote(loaded.page.note ?? "");
        }
      });
    return () => {
      current = false;
    };
  }, [item, moment, chip, pos, path]);

  const page = state.status === "ok" ? state.page : null;
  const onMeasure = useAutoFinish(page, item, () => {
    setRowStatus("Section finished");
  });
  useEffect(() => {
    if (page === null || !page.inApp) return;
    const timer = setTimeout(() => {
      setPhase((now) => (now === "loading" ? "stalled" : now));
    }, STUCK_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [page]);

  if (page === null) {
    return (
      <View style={[styles.page, styles.centered, { backgroundColor: c.page }]}>
        <Stack.Screen options={{ title: "" }} />
        <Text style={{ color: c.ink }}>
          {state.status === "loading"
            ? "Loading…"
            : state.status === "gone"
              ? "This reading is no longer available."
              : "Couldn't open this reading."}
        </Text>
        <RoundButton label="Close" glyph="✕" onPress={leave} />
      </View>
    );
  }

  const openOutside = () => {
    // A page not on https was already counted as a browser open with its click.
    if (page.inApp)
      void recordOutbound(item, page.reached).catch((error: unknown) => {
        console.warn("reader: click not recorded", error);
      });
    void Linking.openURL(page.url).catch((error: unknown) => {
      console.warn("reader: browser not opened", error);
    });
  };
  const save = () => {
    const was = saved;
    setSaved(!was);
    void sendControl(item, was ? "unsave" : "save")
      .catch((error: unknown) => {
        console.warn("reader: save not sent", error);
        return false;
      })
      .then((ok) => {
        if (!ok) setSaved(was);
      });
  };
  const saveNote = () => {
    setNoteStatus("Saving…");
    void writeNote(item, page.reached, note.trim())
      .catch((error: unknown) => {
        console.warn("reader: note not sent", error);
        return false;
      })
      .then((ok) => {
        setNoteStatus(ok ? "Note saved" : "Couldn't save your note");
      });
  };
  const done = () => {
    setRowStatus(null);
    void markDone(item, page.reached)
      .catch((error: unknown) => {
        console.warn("reader: finish not sent", error);
        return false;
      })
      .then((ok) => {
        if (ok) leave();
        else setRowStatus("Couldn't mark this done. Try again.");
      });
  };
  const next = page.nextMomentId;
  const testMe = () => {
    void startQuiz({
      itemId: item,
      ...(page.reached === null ? {} : { momentId: page.reached }),
    })
      .catch((error: unknown) => {
        console.warn("reader: test not started", error);
        return { status: "failed" } as const;
      })
      .then((got) => {
        if (got.status === "ok") router.push(`/quiz/${got.value.attemptId}`);
        else
          setRowStatus(
            got.status === "none"
              ? "No questions on this section yet."
              : "Couldn't start the test. Try again.",
          );
      });
  };

  return (
    <View style={[styles.page, { backgroundColor: c.page }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.bar, { borderColor: c.hairline }]}>
        <RoundButton label="Close reader" glyph="✕" onPress={leave} />
        <Text
          numberOfLines={1}
          style={[
            styles.domain,
            { backgroundColor: c.well, color: c["ink-muted"] },
          ]}
        >
          {page.domain}
        </Text>
        <RoundButton label="Open in browser" glyph="↗" onPress={openOutside} />
      </View>
      <View style={styles.page}>
        {page.inApp ? (
          <WebView
            source={{ uri: page.url }}
            accessibilityLabel={page.title}
            // The publisher's pages only; any other scheme (mailto:, an app's link)
            // goes to the system, which react-native-webview does for what's left out.
            originWhitelist={["https://*", "http://*"]}
            onLoadEnd={() => {
              setPhase((now) => (now === "broken" ? now : "done"));
            }}
            onError={() => {
              setPhase("broken");
            }}
            onHttpError={() => {
              setPhase("broken");
            }}
            {...(page.measure === null
              ? {}
              : {
                  injectedJavaScript: progressScript(
                    page.url,
                    page.measure.start,
                    page.measure.end,
                  ),
                  onMessage: (event: { nativeEvent: { data: string } }) => {
                    onMeasure(event.nativeEvent.data);
                  },
                })}
          />
        ) : (
          <View style={[styles.page, styles.centered, { padding: 24 }]}>
            <Text style={{ color: c.ink }}>{page.title}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={openOutside}
              style={[styles.pill, { backgroundColor: c.ink }]}
            >
              <Text style={{ color: c.page }}>{`Open on ${page.domain}`}</Text>
            </Pressable>
          </View>
        )}
      </View>
      {/* Below the page, never over it (owner, 2026-10-26): heavy pages often look
        ready long before their load event. */}
      {page.inApp && (phase === "stalled" || phase === "broken") ? (
        <View
          accessibilityLiveRegion="polite"
          style={[
            styles.row,
            styles.slow,
            { backgroundColor: c.well, borderColor: c.hairline },
          ]}
        >
          <Text style={[styles.grow, { color: c["ink-muted"] }]}>
            {phase === "broken" ? "Didn't load?" : "Slow to load?"}
          </Text>
          <Pressable accessibilityRole="button" onPress={openOutside}>
            <Text style={[styles.strong, { color: c.ink }]}>
              {`Open on ${page.domain}`}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss slow-load notice"
            onPress={() => {
              setPhase("done");
            }}
          >
            <Text style={{ color: c["ink-muted"] }}>✕</Text>
          </Pressable>
        </View>
      ) : null}
      {noteOpen ? (
        <View style={[styles.notePanel, { borderColor: c.hairline }]}>
          <TextInput
            accessibilityLabel="Your note"
            multiline
            maxLength={NOTE_MAX}
            value={note}
            onChangeText={(text) => {
              setNote(text);
              setNoteStatus(null);
            }}
            placeholder="A private note on this section"
            placeholderTextColor={c["ink-muted"]}
            style={[
              styles.noteInput,
              { color: c.ink, borderColor: c.hairline },
            ]}
          />
          <View style={styles.row}>
            <Pressable
              accessibilityRole="button"
              onPress={saveNote}
              style={[styles.pill, { backgroundColor: c.ink }]}
            >
              <Text style={{ color: c.page }}>Save note</Text>
            </Pressable>
            {noteStatus === null ? null : (
              <Text style={{ color: c["ink-muted"] }}>{noteStatus}</Text>
            )}
          </View>
        </View>
      ) : null}
      {rowStatus === null ? null : (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.status, { color: c.ink }]}
        >
          {rowStatus}
        </Text>
      )}
      <View style={[styles.row, styles.footer, { borderColor: c.hairline }]}>
        <RoundButton
          label={saved ? "Saved" : "Save"}
          glyph={saved ? "★" : "☆"}
          onPress={save}
        />
        <RoundButton label="Highlight" glyph="✎" later />
        {/* P4-W23-S02: the AI explainers of what's shown, queued and played. */}
        <RoundButton
          label="Listen"
          glyph="♫"
          later={!page.listen}
          why="No AI explainer here yet"
          onPress={() => {
            void listen()
              .enqueue(item, page.reached)
              .then((queued) => {
                if (queued) router.push("/listen");
                else setRowStatus("Nothing to listen to here right now.");
              });
          }}
        />
        {/* Test 60s on what's shown, once it has a live question (P4-W21-S01). */}
        <RoundButton
          label="Test me"
          glyph="⚡"
          later={!page.testable}
          why="No questions yet"
          onPress={testMe}
        />
        <RoundButton
          label="Note"
          glyph="✐"
          onPress={() => {
            setNoteOpen(!noteOpen);
          }}
        />
        <View style={styles.end}>
          <RoundButton label="Mark done" glyph="✓" onPress={done} />
          {next === null ? null : (
            <RoundButton
              label="Next section"
              glyph="→"
              strong
              onPress={() => {
                router.setParams({ moment: next });
              }}
            />
          )}
        </View>
      </View>
    </View>
  );
}

// The page script's word (lib/progress-script.ts), checked: the page could post too.
function measured(
  data: string,
): { type: "progress"; value: number } | { type: "unmeasurable" } | null {
  let message: unknown;
  try {
    message = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof message !== "object" || message === null) return null;
  if ("type" in message && message.type === "unmeasurable")
    return { type: "unmeasurable" };
  if (
    "type" in message &&
    message.type === "progress" &&
    "value" in message &&
    typeof message.value === "number" &&
    message.value >= 0 &&
    message.value <= 1
  )
    return { type: "progress", value: message.value };
  return null;
}

// P4-W20-S03 (§5D): finishes the section once, by itself, when it has been read through
// (owner, 2026-11-09: a quiet line, the reader stays). A failed send is tried again.
function useAutoFinish(
  page: ReaderResponse | null,
  item: string,
  finished: () => void,
): (data: string) => void {
  const opened = useRef(0);
  const furthest = useRef(0);
  const sent = useRef(false);
  // Which section's clock this is: an answer for an earlier one (after Next section)
  // changes nothing here.
  const section = useRef(0);
  const retry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The latest callback, so a new one each render doesn't restart the clock.
  const onFinished = useRef(finished);
  onFinished.current = finished;
  const reached = page?.reached ?? null;
  const floorMs =
    page?.measure == null
      ? null
      : Math.max(MIN_SECONDS, page.measure.minutes * 60 * TIME_SHARE) * 1000;
  const check = useCallback(() => {
    if (reached === null || floorMs === null || sent.current) return;
    if (furthest.current < READ_THROUGH) return;
    if (Date.now() - opened.current < floorMs) return;
    sent.current = true;
    const mine = section.current;
    void markDone(item, reached, "auto")
      .catch((error: unknown) => {
        console.warn("reader: automatic finish not sent", error);
        return false;
      })
      .then((ok) => {
        if (mine !== section.current) return;
        if (ok) {
          onFinished.current();
          return;
        }
        sent.current = false;
        retry.current = setTimeout(check, RETRY_MS);
      });
  }, [item, reached, floorMs]);
  useEffect(() => {
    if (floorMs === null) return;
    section.current += 1;
    opened.current = Date.now();
    furthest.current = 0;
    sent.current = false;
    // Read through before the floor: it finishes when the floor passes.
    const timer = setTimeout(check, floorMs);
    return () => {
      section.current += 1;
      clearTimeout(timer);
      clearTimeout(retry.current);
    };
  }, [page, floorMs, check]);
  return (data: string) => {
    const message = measured(data);
    if (message === null) {
      console.warn("reader: a message not from the measuring script");
    } else if (message.type === "unmeasurable") {
      // Owner, 2026-11-09: no automatic finish; Mark done stays.
      console.warn("reader: the section isn't in the page", { item, reached });
    } else {
      furthest.current = Math.max(furthest.current, message.value);
      check();
    }
  };
}

// Shown, not usable yet (owner, ADR-0018 and 2026-11-09): Highlight comes later. Test me
// waits for its section's questions, Listen for a voiced explainer (P4-W23-S02).
function RoundButton({
  label,
  glyph,
  onPress,
  later = false,
  why = "Coming later",
  strong = false,
}: {
  label: string;
  glyph: string;
  onPress?: () => void;
  later?: boolean;
  why?: string;
  strong?: boolean;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={later ? `${label}. ${why}` : label}
      disabled={later}
      onPress={onPress}
      style={[
        styles.round,
        {
          borderColor: c.hairline,
          backgroundColor: strong ? c.ink : c.page,
          opacity: later ? 0.5 : 1,
        },
      ]}
    >
      <Text style={{ color: strong ? c.page : c.ink }}>{glyph}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  centered: { alignItems: "center", justifyContent: "center", gap: 12 },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  domain: {
    flex: 1,
    textAlign: "center",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  slow: { borderTopWidth: 1, paddingHorizontal: 16, paddingVertical: 8 },
  grow: { flex: 1 },
  strong: { fontWeight: "600" },
  status: { paddingHorizontal: 16, paddingTop: 8 },
  notePanel: { borderTopWidth: 1, padding: 12, gap: 8 },
  noteInput: { borderWidth: 1, borderRadius: 12, padding: 10, minHeight: 80 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  footer: { borderTopWidth: 1, paddingHorizontal: 16, paddingVertical: 8 },
  end: { marginLeft: "auto", flexDirection: "row", gap: 8 },
  round: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  pill: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
});
