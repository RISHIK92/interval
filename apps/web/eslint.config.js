import shared from "@interval/config/eslint";
import nextVitals from "eslint-config-next/core-web-vitals";
import { defineConfig } from "eslint/config";

export default defineConfig(
  shared,
  nextVitals,
  { ignores: [".next/**", "next-env.d.ts"] },
  // ADR-0012: drivers and SDKs only in adapters and the composition root.
  {
    files: ["src/**/*.{ts,tsx}"],
    // The Better Auth route handler is framework wiring, like the container.
    ignores: [
      "src/server/adapters/**",
      "src/server/container.ts",
      "src/app/api/auth/**",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "kysely",
                "kysely/*",
                "pg",
                "pg/*",
                "pg-*",
                "better-auth",
                "better-auth/*",
                "@better-auth/*",
                "@aws-sdk/*",
                "bullmq",
                "ioredis",
              ],
              message:
                "Use a port; drivers live in src/server/adapters (ADR-0012).",
            },
          ],
        },
      ],
    },
  },
);
