# Build from the repo root: docker build -f apps/web/Dockerfile -t interval-web .
# node:22.22.3-bookworm-slim, pinned by digest.
FROM node:22.22.3-bookworm-slim@sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752 AS base
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/config/package.json packages/config/
COPY packages/db/package.json packages/db/
COPY infra/package.json infra/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @interval/web...
COPY packages/config packages/config
# Only the TS side of packages/db; its Python and migrations do not affect the web build.
COPY packages/db/src packages/db/src
COPY apps/web apps/web
RUN pnpm --filter @interval/web build

# Standalone output (ARCH-1, LOAD-1): one stateless container serving pages and API.
# Add a COPY for apps/web/public when that directory exists.
FROM node:22.22.3-bookworm-slim@sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752 AS run
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
# Code stays root-owned and read-only to the app; only Next's cache directory is writable.
RUN mkdir -p apps/web/.next/cache && chown node:node apps/web/.next/cache
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
