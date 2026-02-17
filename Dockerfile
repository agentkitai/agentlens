# Single-stage build — pnpm symlinks don't survive multi-stage COPY
FROM node:22-slim

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.18.2 --activate

# Copy workspace config first for layer caching
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.json ./
COPY packages/core/package.json packages/core/
COPY packages/auth/package.json packages/auth/
COPY packages/server/package.json packages/server/
COPY packages/dashboard/package.json packages/dashboard/

# Install all deps
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY packages/core/ packages/core/
COPY packages/auth/ packages/auth/
COPY packages/server/ packages/server/
COPY packages/dashboard/ packages/dashboard/
RUN pnpm run build

# Cleanup source (keep only dist)
RUN rm -rf packages/core/src packages/auth/src packages/server/src packages/dashboard/src \
    packages/*/tsconfig.json packages/*/__tests__ packages/*/vitest.config.*

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/stats').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"

# Ensure data dir is writable
RUN mkdir -p /app/data && chown node:node /app/data

USER node

CMD ["node", "-e", "import('./packages/server/dist/index.js').then(m => m.startServer())"]
