# syntax=docker/dockerfile:1

# ============================================
# Stage 1: Build base with pnpm
# ============================================
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# ============================================
# Stage 2: Install dependencies
# ============================================
FROM base AS deps
# Copy workspace configuration
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/storage/package.json ./packages/storage/
COPY apps/backend/package.json ./apps/backend/

# Install all dependencies
RUN pnpm install --frozen-lockfile

# ============================================
# Stage 3: Build
# ============================================
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/storage/node_modules ./packages/storage/node_modules
COPY --from=deps /app/apps/backend/node_modules ./apps/backend/node_modules
COPY . .

# Generate Prisma client and build
RUN pnpm --filter @avault/shared db:generate
RUN pnpm --filter @avault/shared build
RUN pnpm --filter @avault/storage build
RUN pnpm --filter @avault/backend build

# ============================================
# Stage 4: Production runtime
# ============================================
FROM node:20-alpine AS runner
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Create non-root user
RUN addgroup --system --gid 1001 avault && \
    adduser --system --uid 1001 avault
WORKDIR /app

# Copy built application
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
COPY --from=builder --chown=avault:avault /app/apps/backend/dist ./apps/backend/dist
COPY --from=builder --chown=avault:avault /app/apps/backend/package.json ./apps/backend/
COPY --from=builder --chown=avault:avault /app/apps/backend/node_modules ./apps/backend/node_modules

USER avault
EXPOSE 4000

ENV NODE_ENV=production
ENV PORT=4000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4000/api/health || exit 1

CMD ["node", "apps/backend/dist/index.js"]
