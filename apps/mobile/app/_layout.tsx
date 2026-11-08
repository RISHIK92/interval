import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColors, useScheme } from "../components/theme";

// P4-W19-S01 (§4.1): the five areas are tabs; Profile opens over them from the avatar.
// P4-W19-S02: the navigation chrome in the design system's colors, light or dark.
export default function RootLayout() {
  const scheme = useScheme();
  const c = useColors();
  const base = scheme === "dark" ? DarkTheme : DefaultTheme;
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
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="profile" options={{ title: "Profile" }} />
      </Stack>
    </ThemeProvider>
  );
}
