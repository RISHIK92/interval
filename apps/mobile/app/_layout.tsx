import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { useRef } from "react";
import { StatusBar } from "expo-status-bar";
import { useColors, useScheme } from "../components/theme";
import { authClient } from "../lib/auth";

// P4-W19-S01 (§4.1): the five areas are tabs; Profile opens over them from the avatar.
// P4-W19-S02: the navigation chrome in the design system's colors, light or dark.
export default function RootLayout() {
  const scheme = useScheme();
  const c = useColors();
  const base = scheme === "dark" ? DarkTheme : DefaultTheme;
  // P4-W19-S03: signed out, only sign-in; nothing while the stored session is read.
  const { data, isPending } = authClient.useSession();
  // Only the first read: later refetches (a return to the foreground, a reconnect) also
  // report pending, and unmounting then would wipe a half-typed sign-in.
  const settled = useRef(false);
  if (!isPending) settled.current = true;
  if (!settled.current) return null;
  const signedIn = data !== null;
  return (
    <ThemeProvider
      value={{
        ...base,
        colors: {
          ...base.colors,
          background: c.page,
          card: c.page,
          text: c.ink,
          border: c.hairline,
          primary: c.select,
        },
      }}
    >
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="profile" options={{ title: "Profile" }} />
          {/* Every other screen is for a signed-in user too: signed out, a deep link to
            one lands on sign-in (P4-W21-S03). */}
          <Stack.Screen name="read/[item]" />
          <Stack.Screen name="quiz/[attempt]/index" />
          <Stack.Screen name="quiz/[attempt]/results" />
          <Stack.Screen name="live/[mode]" />
          <Stack.Screen name="paths/[path]" />
          <Stack.Screen name="boards" options={{ title: "Boards" }} />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}
