import shared from "@interval/config/eslint";
import { defineConfig } from "eslint/config";

// P4-W19-S01: the repo's type-checked rules; the app's generated and native folders
// are not ours to lint.
export default defineConfig(shared, {
  ignores: [".expo/**", "ios/**", "android/**", "expo-env.d.ts"],
});
