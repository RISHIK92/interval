import { type } from "@interval/tokens";
import { StyleSheet, Text, View } from "react-native";
import { useColors } from "./theme";

// P4-W19-S01: each area's place until its slice fills it (docs/roadmap/phase-4-slices.md).
export function Placeholder({
  title,
  arrives,
}: {
  title: string;
  arrives: string;
}) {
  const c = useColors();
  return (
    <View style={[styles.page, { backgroundColor: c.page }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: c.ink }]}>
        {title}
      </Text>
      <Text style={[styles.note, { color: c["ink-muted"] }]}>
        Arrives in {arrives}.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 24, gap: 8 },
  title: {
    fontSize: type.display.size,
    fontWeight: type.display.weight,
    lineHeight: type.display.size * type.display.lineHeight,
    letterSpacing: type.display.size * type.display.letterSpacing,
  },
  note: { fontSize: type.body.size },
});
