import { Link, Tabs } from "expo-router";
import { BottomTabBar } from "expo-router/tabs";
import { Pressable, StyleSheet, Text } from "react-native";
import { MiniPlayer } from "../../components/MiniPlayer";
import { useColors } from "../../components/theme";

// §4.1: Home, Explore, Paths, Play and Library; Profile from the avatar, not a tab.
function Avatar() {
  const c = useColors();
  return (
    <Link href="/profile" asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Profile"
        // One object, not an array: Link's asChild passes it through a Slot.
        style={{ ...styles.avatar, backgroundColor: c.well }}
      >
        <Text style={[styles.glyph, { color: c.ink }]}>·</Text>
      </Pressable>
    </Link>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{ headerRight: () => <Avatar /> }}
      // P4-W23-S02 (§4.1): the mini-player sits on the tab bar, on every tab.
      tabBar={(props) => (
        <>
          <MiniPlayer />
          <BottomTabBar {...props} />
        </>
      )}
    >
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
  },
  glyph: { fontWeight: "600" },
});
