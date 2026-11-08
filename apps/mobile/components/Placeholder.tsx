import { StyleSheet, Text, View } from "react-native";

// P4-W19-S01: each area's place until its slice fills it (docs/roadmap/phase-4-slices.md).
export function Placeholder({
  title,
  arrives,
}: {
  title: string;
  arrives: string;
}) {
  return (
    <View style={styles.page}>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      <Text style={styles.note}>Arrives in {arrives}.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 24, gap: 8 },
  title: { fontSize: 28, fontWeight: "700" },
  note: { color: "#57534e" },
});
