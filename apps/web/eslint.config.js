import shared from "@interval/config/eslint";
import nextVitals from "eslint-config-next/core-web-vitals";
import { defineConfig } from "eslint/config";

export default defineConfig(shared, nextVitals, {
  ignores: [".next/**", "next-env.d.ts"],
});
