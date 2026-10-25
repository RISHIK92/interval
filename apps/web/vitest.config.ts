import { defineConfig } from "vitest/config";

// tsconfig keeps `jsx: preserve` for Next; tests compile JSX themselves.
export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  // Test-only Better Auth settings; real values come from the environment.
  test: {
    env: {
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0123",
      BETTER_AUTH_URL: "http://localhost:3100",
    },
  },
});
