# syntax=docker/dockerfile:1
# Build context: monorepo root
#   docker build -f apps/web/Dockerfile -t ud-transport-web \
#     --build-arg NEXT_PUBLIC_API_URL="https://api.example.com" .
#
# .dockerignore MUST include:  .env  .env.*  **/node_modules  **/.git

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
COPY apps/web/package.json                   apps/web/package.json
RUN pnpm install --frozen-lockfile

# ── builder: compile TypeScript ──────────────────────────────────────────────
FROM deps AS builder
WORKDIR /app
COPY packages/types/             packages/types/
COPY packages/typescript-config/ packages/typescript-config/
COPY packages/eslint-config/     packages/eslint-config/
COPY packages/ui/                packages/ui/
COPY apps/web/                   apps/web/
# @repo/types ships compiled (dist/) — `pnpm --filter` does not build workspace
# deps first (that's a turbo dependsOn behavior, not plain pnpm), so this must
# run explicitly or `next build` resolves @repo/types to missing/stale JS.
RUN pnpm --filter @repo/types build

# NEXT_PUBLIC_* vars are inlined into the client bundle at build time, not read
# at runtime — this MUST be a build-arg, or the image silently ships pointing
# at the lib/api.ts fallback of http://localhost:3001.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm --filter web build

# ── runner: minimal production image ─────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

# Monorepo standalone output preserves the workspace path structure (Next
# auto-detects the pnpm workspace root for output file tracing), so the
# runnable server.js and its node_modules land under apps/web/, not at the
# copy root — mirror that instead of flattening it.
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

ENV NODE_ENV=production
# standalone server.js binds to localhost by default — unreachable from
# outside the container unless explicitly bound to all interfaces.
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
EXPOSE 3000

CMD ["node", "apps/web/server.js"]
