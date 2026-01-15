# syntax=docker/dockerfile:1

# ============================================
# Stage 1: Build base with pnpm
# ============================================
FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# ============================================
# Stage 2: Install dependencies
# ============================================
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/storage/package.json ./packages/storage/
COPY apps/worker/package.json ./apps/worker/

RUN pnpm install --frozen-lockfile

# ============================================
# Stage 3: Build
# ============================================
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/storage/node_modules ./packages/storage/node_modules
COPY --from=deps /app/apps/worker/node_modules ./apps/worker/node_modules
COPY . .

RUN pnpm --filter @avault/shared db:generate
RUN pnpm --filter @avault/shared build
RUN pnpm --filter @avault/storage build
RUN pnpm --filter @avault/worker build

# ============================================
# Stage 4: Production runtime
# ============================================
FROM node:24-alpine AS runner
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

RUN addgroup --system --gid 1001 avault && \
    adduser --system --uid 1001 avault
WORKDIR /app

COPY --from=builder --chown=avault:avault /app/package.json ./
COPY --from=builder --chown=avault:avault /app/pnpm-workspace.yaml ./
COPY --from=builder --chown=avault:avault /app/node_modules ./node_modules
COPY --from=builder --chown=avault:avault /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder --chown=avault:avault /app/packages/shared/package.json ./packages/shared/
COPY --from=builder --chown=avault:avault /app/packages/shared/prisma ./packages/shared/prisma
COPY --from=builder --chown=avault:avault /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=builder --chown=avault:avault /app/packages/storage/dist ./packages/storage/dist
COPY --from=builder --chown=avault:avault /app/packages/storage/package.json ./packages/storage/
COPY --from=builder --chown=avault:avault /app/packages/storage/node_modules ./packages/storage/node_modules
COPY --from=builder --chown=avault:avault /app/apps/worker/dist ./apps/worker/dist
COPY --from=builder --chown=avault:avault /app/apps/worker/package.json ./apps/worker/
COPY --from=builder --chown=avault:avault /app/apps/worker/node_modules ./apps/worker/node_modules

USER avault

ENV NODE_ENV=production
ENV WORKER_CONCURRENCY=2

CMD ["node", "apps/worker/dist/index.js"]
