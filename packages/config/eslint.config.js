import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  { ignores: ["packages/db/src/generated/**", "src/generated/**"] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true },
    },
  },
  // Config files are plain JS outside each tsconfig, so type-aware rules cannot run on them.
  {
    files: ["**/*.config.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
