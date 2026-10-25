import { defineConfig } from "vitest/config";

// Synthesising the CDK stack in beforeAll takes over 10 s on CI runners.
export default defineConfig({
  // cdk.out holds staged copies of the repo (image assets); only test infra's own code.
  test: { hookTimeout: 60_000, include: ["src/**/*.test.ts"] },
});
