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
COPY packages/events/package.json packages/events/
COPY infra/package.json infra/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @interval/web...
COPY packages/config packages/config
# Only the TS side of packages/db; its Python and migrations do not affect the web build.
COPY packages/db/src packages/db/src
# Only the generated TS of packages/events; events.json and the generator are build-time.
COPY packages/events/src/generated.ts packages/events/src/generated.ts
COPY apps/web apps/web
RUN pnpm --filter @interval/web build

# Standalone output (ARCH-1, LOAD-1): one stateless container serving pages and API.
FROM node:22.22.3-bookworm-slim@sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752 AS run
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
# Standalone output leaves out public/: the service worker and the manifest icons.
COPY --from=build /repo/apps/web/public ./apps/web/public
# Code stays root-owned and read-only to the app; only Next's cache directory is writable.
RUN mkdir -p apps/web/.next/cache && chown node:node apps/web/.next/cache
# Amazon RDS CA bundle (pinned digest) for verify-full TLS in the AWS mode (ADR-0011).
ADD --checksum=sha256:90a6f1a7978a1b1b096dca6c57511ca48d3b8cf052f8e704baf358f34ea2f21b --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /certs/rds-global-bundle.pem
# ADD's --chmod also applies to the directory it creates; make it traversable.
RUN chmod 755 /certs
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
