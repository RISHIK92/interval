import { tmpdir } from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

// tsconfig keeps `jsx: preserve` for Next; tests compile JSX themselves.
export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    // DB-backed tests start Better Auth and hash passwords; under `turbo check`, lint,
    // typecheck, synth and pytest share the machine, so 5 s is too tight. Still catches hangs.
    testTimeout: 15_000,
    // Test-only auth and mail settings; real values come from the environment.
    env: {
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0123",
      BETTER_AUTH_URL: "http://localhost:3100",
      MAIL_TRANSPORT: "log",
      EVENTS_TRANSPORT: "file",
      EVENTS_DIR: path.join(tmpdir(), "interval-test-events"),
    },
  },
});
