import { defineConfig } from "vitest/config";

// Synthesising the CDK stack in beforeAll takes over 10 s on CI runners.
export default defineConfig({
  test: { hookTimeout: 60_000 },
});
