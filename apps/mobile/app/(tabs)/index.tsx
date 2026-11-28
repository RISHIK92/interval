import type {
  CardControl,
  FeedCard as Card,
  FeedSetup,
} from "@interval/api-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { FeedCard, type MenuControl } from "../../components/FeedCard";
import { useColors } from "../../components/theme";
import { readFeed, sendControl } from "../../lib/feed";

// A feed card's open names its position, as the web's (card_opened). ADR-0058: always
// the whole article.
const readHref = (card: Card, position: number) =>
  `/read/${card.itemId}?pos=${String(position)}`;

// The controls that take a card out of this feed at once (PER-1).
const REMOVES: MenuControl[] = ["not_interested", "hide_source"];

type State =
  | { status: "loading" }
  | { status: "ok"; cards: Card[] }
  | { status: "setup"; setup: FeedSetup["setup"] }
  | { status: "forbidden" }
  | { status: "failed" };

// P4-W20-S01 (§5A, CACHE-1): Home's feed, the same precomputed cards as the PWA's.
export default function HomeScreen() {
  const c = useColors();
  const [state, setState] = useState<State>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  // Only the latest request's answer is shown: a slow earlier one is dropped.
  const latest = useRef(0);

  const load = useCallback(async () => {
    latest.current += 1;
    const asked = latest.current;
    const loaded = await readFeed().catch((error: unknown) => {
      console.warn("feed: not read", error);
      return { status: "failed" } as const;
    });
    if (asked !== latest.current) return;
    if (loaded.status === "ok")
      setState({ status: "ok", cards: loaded.feed.cards });
    else setState(loaded);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const cards = (update: (cards: Card[]) => Card[]) => {
    setState((s) => (s.status === "ok" ? { ...s, cards: update(s.cards) } : s));
  };
  // A control the server didn't take is undone, so the card shows what's stored.
  const send = (
    card: Card,
    control: CardControl,
    undo: () => void,
    applied: () => void = () => undefined,
  ) => {
    void sendControl(card.itemId, control)
      .catch((error: unknown) => {
        console.warn("feed: control not sent", error);
        return false;
      })
      .then((ok) => {
        if (ok) applied();
        else undo();
      });
  };

  const save = (card: Card) => {
    const set = (saved: boolean) => {
      cards((all) =>
        all.map((x) => (x.itemId === card.itemId ? { ...x, saved } : x)),
      );
    };
    set(!card.saved);
    send(card, card.saved ? "unsave" : "save", () => {
      set(card.saved);
    });
  };
  const menu = (card: Card, control: MenuControl) => {
    if (!REMOVES.includes(control)) {
      send(card, control, () => undefined);
      return;
    }
    // Where it was in the list on screen, to put it back there.
    const at =
      state.status === "ok"
        ? state.cards.findIndex((x) => x.itemId === card.itemId)
        : -1;
    cards((all) => all.filter((x) => x.itemId !== card.itemId));
    send(
      card,
      control,
      () => {
        cards((all) =>
          at < 0 || all.some((x) => x.itemId === card.itemId)
            ? all
            : [...all.slice(0, at), card, ...all.slice(at)],
        );
      },
      () => {
        // Read again once stored: Hide source takes the source's other cards too, and a
        // read already in flight (from before the control) is dropped.
        void load();
      },
    );
  };

  const message =
    state.status === "loading"
      ? "Loading your feed…"
      : state.status === "setup"
        ? state.setup === "username"
          ? "Pick a username on the web, then come back."
          : "Finish setting up on the web (topics and level), then come back."
        : state.status === "forbidden"
          ? "Your plan doesn't include the feed."
          : state.status === "failed"
            ? "Couldn't load your feed. Pull to try again."
            : "Nothing to read yet.";

  return (
    <View style={[styles.page, { backgroundColor: c.page }]}>
      {/* Always the list, so pull to refresh works from every state. */}
      <FlatList
        testID="feed"
        data={state.status === "ok" ? state.cards : []}
        keyExtractor={(card) => card.itemId}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load().finally(() => {
                setRefreshing(false);
              });
            }}
          />
        }
        ListEmptyComponent={
          <Text
            style={{
              color: state.status === "loading" ? c["ink-muted"] : c.ink,
            }}
          >
            {message}
          </Text>
        }
        renderItem={({ item, index }) => (
          <FeedCard
            card={item}
            href={readHref(item, index + 1)}
            onSave={() => {
              save(item);
            }}
            onMenu={(control) => {
              menu(item, control);
            }}
          />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 16, gap: 12 },
  list: { gap: 12, paddingBottom: 24 },
});
