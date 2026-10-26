import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: [
      "packages/db/src/generated/**",
      "src/generated/**",
      "**/cdk.out/**",
    ],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true },
    },
  },
  // Config files and a web app's static scripts (the service worker) are plain JS
  // outside each tsconfig, so type-aware rules cannot run on them.
  {
    files: ["**/*.config.js", "**/*.config.mjs", "**/public/**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
