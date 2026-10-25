import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  // The monorepo root, so standalone output traces workspace packages too.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  transpilePackages: ["@interval/db"],
};

export default config;
