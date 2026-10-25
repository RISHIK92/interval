import { defineConfig } from "vitest/config";

// tsconfig keeps `jsx: preserve` for Next; tests compile JSX themselves.
export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
});
