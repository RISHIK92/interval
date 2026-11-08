import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

// P4-W19-S01 (§4.1): the five areas are tabs; Profile opens over them from the avatar.
// Light only until W19-S02's tokens bring the dark palette.
export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="profile" options={{ title: "Profile" }} />
      </Stack>
    </>
  );
}
