import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  // The monorepo root, so standalone output traces workspace packages too.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  // Workspace packages that ship TypeScript source (ARCH-3's shared ones too).
  transpilePackages: [
    "@interval/db",
    "@interval/events",
    "@interval/api-client",
    "@interval/game-client",
    "@interval/scoring",
    "@interval/diagrams",
    "@interval/hld",
  ],
  // CLAUDE.md is the one place for agent rules (owner, 2026-10-25).
  agentRules: false,
  // Development only: testing on a phone through an ngrok HTTPS tunnel (owner,
  // 2026-10-26), and a second signed-in session on 127.0.0.1 beside localhost (its own
  // cookies). Next blocks dev requests from origins not listed here.
  allowedDevOrigins: [
    "*.ngrok-free.app",
    "*.ngrok-free.dev",
    "*.ngrok.app",
    "127.0.0.1",
  ],
  // P4-W23-S01: voiced explainers' HLS under /media/*. CloudFront (AWS) and Caddy (VM)
  // serve it from the media bucket in front of the app; in development, with the local
  // SeaweedFS set in .env, Next forwards it the same way.
  rewrites: () =>
    Promise.resolve(
      process.env.NODE_ENV === "development" &&
        process.env["MEDIA_S3_ENDPOINT"] !== undefined &&
        process.env["MEDIA_BUCKET"] !== undefined
        ? [
            {
              source: "/media/:path*",
              destination: `${process.env["MEDIA_S3_ENDPOINT"]}/${process.env["MEDIA_BUCKET"]}/media/:path*`,
            },
          ]
        : [],
    ),
  // ADR-0018: the in-app reader frames publishers' pages over https only.
  headers: () =>
    Promise.resolve([
      {
        source: "/read/:item",
        headers: [
          { key: "Content-Security-Policy", value: "frame-src https:" },
        ],
      },
    ]),
};

export default config;
