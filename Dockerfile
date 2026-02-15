# ── Build stage ──────────────────────────────────────────────
FROM node:22 AS build

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.18.2 --activate

# Copy workspace config first for layer caching
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/dashboard/package.json packages/dashboard/

# Install all deps (including devDependencies for build)
RUN pnpm install --frozen-lockfile

# Copy source
COPY tsconfig.json ./
COPY packages/core/ packages/core/
COPY packages/server/ packages/server/
COPY packages/dashboard/ packages/dashboard/

# Build everything (core → server + dashboard)
RUN pnpm run build

# ── Dependencies stage ──────────────────────────────────────
FROM node:22-slim AS deps

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.18.2 --activate

# Copy workspace config
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/dashboard/package.json packages/dashboard/

# Install production deps only, then fix sharp native addon
RUN pnpm install --frozen-lockfile --prod && \
    cd node_modules/.pnpm/sharp@*/node_modules/sharp && \
    npm install --ignore-scripts=false 2>/dev/null || true

# ── Production stage ────────────────────────────────────────
FROM gcr.io/distroless/nodejs22-debian12

WORKDIR /app

# Copy production deps and built artifacts
COPY --from=deps /app/node_modules/ node_modules/
COPY --from=deps /app/pnpm-workspace.yaml /app/package.json ./
COPY --from=deps /app/packages/core/package.json packages/core/
COPY --from=deps /app/packages/server/package.json packages/server/
COPY --from=deps /app/packages/dashboard/package.json packages/dashboard/
COPY --from=build /app/packages/core/dist/ packages/core/dist/
COPY --from=build /app/packages/server/dist/ packages/server/dist/
COPY --from=build /app/packages/dashboard/dist/ packages/dashboard/dist/

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

USER nonroot

CMD ["--experimental-modules", "./packages/server/dist/index.js"]
