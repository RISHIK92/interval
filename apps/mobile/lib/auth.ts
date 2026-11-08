import { expoClient } from "@better-auth/expo/client";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";

// P4-W19-S03 (Q-P4-02): the same accounts as the web, signed in with Better Auth's Expo
// plugin; the session cookie lives in SecureStore. The simulator reaches the Mac's
// localhost; a phone needs EXPO_PUBLIC_API_URL set to the site.
export const SITE =
  process.env["EXPO_PUBLIC_API_URL"] ?? "http://localhost:3100";

export const authClient = createAuthClient({
  baseURL: SITE,
  plugins: [
    expoClient({
      scheme: "interval",
      storagePrefix: "interval",
      storage: SecureStore,
    }),
  ],
});
