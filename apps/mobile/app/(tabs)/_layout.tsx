import { Link, Tabs } from "expo-router";
import { Pressable, StyleSheet, Text } from "react-native";

// §4.1: Home, Explore, Paths, Play and Library; Profile from the avatar, not a tab.
function Avatar() {
  return (
    <Link href="/profile" asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Profile"
        style={styles.avatar}
      >
        <Text style={styles.glyph}>·</Text>
      </Pressable>
    </Link>
  );
}

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerRight: () => <Avatar /> }}>
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="explore" options={{ title: "Explore" }} />
      <Tabs.Screen name="paths" options={{ title: "Paths" }} />
      <Tabs.Screen name="play" options={{ title: "Play" }} />
      <Tabs.Screen name="library" options={{ title: "Library" }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  avatar: {
    width: 32,
    height: 32,
    marginRight: 16,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#e7e5e4",
  },
  glyph: { fontWeight: "600" },
});
