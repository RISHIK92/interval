import type { FeedCard as Card } from "@interval/api-client";
import { type } from "@interval/tokens";
import { Link } from "expo-router";
import {
  ActionSheetIOS,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useColors } from "./theme";

const MENU = [
  ["More like this", "more_like_this"],
  ["Less like this", "less_like_this"],
  ["Not interested", "not_interested"],
  ["Hide source", "hide_source"],
] as const;
export type MenuControl = (typeof MENU)[number][1];

// The card menu: the platform's own sheet (iOS) or alert (Android).
function openMenu(pick: (control: MenuControl) => void) {
  const labels = [...MENU.map(([label]) => label), "Cancel"];
  const chose = (index: number) => {
    const entry = MENU[index];
    if (entry !== undefined) pick(entry[1]);
  };
  if (Platform.OS === "ios") {
    ActionSheetIOS.showActionSheetWithOptions(
      { options: labels, cancelButtonIndex: MENU.length },
      chose,
    );
    return;
  }
  Alert.alert("This card", undefined, [
    ...MENU.map(([label], i) => ({
      text: label,
      onPress: () => {
        chose(i);
      },
    })),
    { text: "Cancel", style: "cancel" as const },
  ]);
}

// P4-W20-S01 (§5A, §3.2): what a card may show, as the PWA's: no body text. The project
// note is the model's, so labeled (AI-3).
export function FeedCard({
  card,
  onSave,
  onMenu,
}: {
  card: Card;
  onSave: () => void;
  onMenu: (control: MenuControl) => void;
}) {
  const c = useColors();
  const minutes =
    card.estimatedMinutes === null
      ? null
      : `${String(card.estimatedMinutes)} min`;
  const where =
    card.kind === "moment"
      ? `Section ${String(card.sectionNumber)} of ${String(card.sectionCount)} · ${minutes ?? ""}`
      : (minutes ?? "Article");
  return (
    <View
      style={[
        styles.card,
        { borderColor: c.hairline, backgroundColor: c.page },
      ]}
    >
      <Link href={`/read/${card.itemId}`} asChild>
        <Pressable accessibilityRole="link" style={styles.body}>
          <Text style={[styles.title, { color: c.ink }]}>
            {card.articleTitle}
          </Text>
          {card.kind === "moment" ? (
            <Text style={{ color: c.ink }}>{card.sectionTitle}</Text>
          ) : null}
          <Text style={{ color: c["ink-muted"] }}>{where}</Text>
          <Text style={{ color: c["ink-muted"] }}>{card.sourceName}</Text>
        </Pressable>
      </Link>
      {/* As the PWA: the project note replaces the why-this-matters line (ADR-0027). */}
      {card.projectNote !== null ? (
        <View style={[styles.ai, { borderColor: c.hairline }]}>
          <Text style={{ color: c.ink }}>
            <Text style={styles.strong}>
              For your{" "}
              {card.projectNote.repositories.length > 1
                ? "projects"
                : "project"}{" "}
              {card.projectNote.repositories.join(", ")}:
            </Text>{" "}
            {card.projectNote.text}
          </Text>
          <Text
            style={[
              styles.tag,
              { backgroundColor: c.well, color: c["ink-muted"] },
            ]}
          >
            AI
          </Text>
        </View>
      ) : card.reasons === null ? null : (
        <Text style={{ color: c["ink-muted"] }}>{card.reasons.text}</Text>
      )}
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          onPress={onSave}
          style={[styles.pill, { borderColor: c.hairline }]}
        >
          <Text style={{ color: c.ink }}>{card.saved ? "Saved" : "Save"}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="More options"
          onPress={() => {
            openMenu(onMenu);
          }}
          style={[styles.pill, { borderColor: c.hairline }]}
        >
          <Text style={{ color: c.ink }}>⋯</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 20, padding: 16, gap: 8 },
  body: { gap: 4 },
  strong: { fontWeight: "600" },
  title: { fontSize: type.section.size, fontWeight: type.section.weight },
  ai: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 12,
    padding: 10,
    gap: 4,
  },
  tag: {
    alignSelf: "flex-start",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontSize: 12,
    fontWeight: "600",
  },
  actions: { flexDirection: "row", gap: 8 },
  pill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
});
