# syntax=docker/dockerfile:1
# Build context: monorepo root
#   docker build -f apps/api/Dockerfile -t ud-transport-api .
#
# .dockerignore MUST include:  .env  .env.*  **/node_modules  **/.git
# Secrets are NEVER baked into the image — pass them at runtime, e.g.:
#   docker run \
#     -e JWT_SECRET="..." \
#     -e DATABASE_URL="postgresql://..." \
#     -e MINIO_ACCESS_KEY="..." \
#     -e MINIO_SECRET_KEY="..." \
#     -e MINIO_PUBLIC_ENDPOINT="https://..." \
#     -e FRONTEND_URL="https://..." \
#     ud-transport-api

# ── base: node + pnpm ────────────────────────────────────────────────────────
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# ── deps: install all workspace dependencies ─────────────────────────────────
FROM base AS deps
WORKDIR /app
# Manifests only — no source, no .env files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/types/package.json             packages/types/package.json
COPY packages/typescript-config/package.json packages/typescript-config/package.json
COPY packages/eslint-config/package.json     packages/eslint-config/package.json
COPY packages/ui/package.json                packages/ui/package.json
COPY apps/api/package.json                   apps/api/package.json
# postinstall runs `prisma generate` automatically
RUN pnpm install --frozen-lockfile

# ── builder: compile TypeScript ──────────────────────────────────────────────
FROM deps AS builder
WORKDIR /app
COPY packages/types/             packages/types/
COPY packages/typescript-config/ packages/typescript-config/
COPY apps/api/src/               apps/api/src/
COPY apps/api/prisma/            apps/api/prisma/
COPY apps/api/tsconfig.json      apps/api/tsconfig.json
# @repo/types now ships compiled (dist/, see package.json main/exports) instead of raw source —
# `pnpm --filter api build/deploy` do NOT build workspace dependencies first (that's a turbo
# `dependsOn: ["^build"]` behavior, not a plain pnpm --filter one), so this must run explicitly
# or the deployed image silently ships without @repo/types' compiled JS.
RUN pnpm --filter @repo/types build
RUN pnpm --filter api build
# `pnpm deploy` creates a self-contained dir: compiled dist/ + prod node_modules only.
# Workspace packages (@repo/types) are inlined — no symlinks in the final image.
RUN pnpm --filter api deploy --prod /deploy
# `pnpm deploy`'s own postinstall re-run of `prisma generate` resolves @prisma/client back
# into THIS stage's shared pnpm store instead of /deploy's isolated tree — verified by hand:
# the deployed image boots to "Nest application successfully started" and then crashes with
# `Cannot find module '.prisma/client/default'`, because /deploy/node_modules never actually
# got its own generated client. Re-running generate explicitly, with cwd=/deploy so Prisma
# resolves the schema and the @prisma/client install location from THERE, fixes it — verified
# by booting the deployed dist/main.js against a real Postgres and completing a real login.
RUN cd /deploy && /app/node_modules/.bin/prisma generate

# ── runner: minimal production image ─────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
COPY --from=builder /deploy .

ENV NODE_ENV=production
EXPOSE 3001

# Required at runtime (docker run -e / compose environment: / K8s secretKeyRef):
#   JWT_SECRET             — min 32 chars random entropy
#   DATABASE_URL           — postgresql://user:pass@host:5432/db
#   MINIO_ACCESS_KEY
#   MINIO_SECRET_KEY
#   MINIO_PUBLIC_ENDPOINT  — public base URL for presigned URLs (e.g. https://files.example.com)
#   FRONTEND_URL           — e.g. https://app.example.com
CMD ["node", "dist/main"]
