import { defineConfig } from "vitest/config";

// Synthesising the CDK stack in beforeAll stages copies of the repo for its image assets:
// alone it takes seconds, but under the full check (every package's tests at once, on CI
// runners and locally) it passed 60 s and failed CI. Five minutes still catches a hang.
export default defineConfig({
  // cdk.out holds staged copies of the repo (image assets); only test infra's own code.
  test: { hookTimeout: 300_000, include: ["src/**/*.test.ts"] },
});
