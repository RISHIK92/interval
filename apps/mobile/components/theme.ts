import { palette, type Scheme } from "@interval/tokens";
import { useColorScheme } from "react-native";

// P4-W19-S02 (ARCH-3): the design system's colors for the device's scheme.
export function useScheme(): Scheme {
  return useColorScheme() === "dark" ? "dark" : "light";
}

export function useColors(): ReturnType<typeof palette> {
  return palette(useScheme());
}
