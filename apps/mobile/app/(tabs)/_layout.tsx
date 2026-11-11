import * as Notifications from "expo-notifications";
import { Link, Tabs, useRouter } from "expo-router";
import { useEffect } from "react";
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

// P4-W24-S01b: a tapped notification opens its page: a path in the app, as the worker
// names it, never another scheme or host ("//host", "/\\host"), and no whitespace.
const PAGE = /^\/(?![/\\])\S*$/;

const pageOf = (notification: Notifications.Notification): string | null => {
  const url: unknown = notification.request.content.data?.["url"];
  return typeof url === "string" && PAGE.test(url) ? url : null;
};

// The one that launched the app, then any tapped while it runs; only signed in (the
// tabs are). useRouter's queue takes a push from the first render on (the global router
// is bound a commit later). The launching one is cleared once opened, so signing in
// again doesn't reopen it.
function OpenTapped() {
  const navigation = useRouter();
  useEffect(() => {
    const open = (notification: Notifications.Notification) => {
      const page = pageOf(notification);
      if (page !== null) navigation.push(page);
    };
    const launched = Notifications.getLastNotificationResponse();
    if (launched !== null) {
      open(launched.notification);
      Notifications.clearLastNotificationResponse();
    }
    const tapped = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        open(response.notification);
      },
    );
    return () => {
      tapped.remove();
    };
  }, [navigation]);
  return null;
}

export default function TabsLayout() {
  return (
    <>
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
      <OpenTapped />
    </>
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
