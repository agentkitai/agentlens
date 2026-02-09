# Stage 1: Build
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@10.18.2 --activate

WORKDIR /app

# Copy dependency manifests first for layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/dashboard/package.json packages/dashboard/
COPY packages/sdk/package.json packages/sdk/
COPY packages/mcp/package.json packages/mcp/
COPY packages/cli/package.json packages/cli/
COPY packages/pool-server/package.json packages/pool-server/

RUN pnpm install --frozen-lockfile

# Copy source and build
COPY . .
RUN pnpm -r build

# Stage 2: Production
FROM node:22-alpine

RUN corepack enable && corepack prepare pnpm@10.18.2 --activate

WORKDIR /app

COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/packages/core/package.json packages/core/
COPY --from=builder /app/packages/core/dist packages/core/dist
COPY --from=builder /app/packages/server/package.json packages/server/
COPY --from=builder /app/packages/server/dist packages/server/dist
COPY --from=builder /app/packages/dashboard/package.json packages/dashboard/
COPY --from=builder /app/packages/dashboard/dist packages/dashboard/dist
COPY --from=builder /app/packages/sdk/package.json packages/sdk/
COPY --from=builder /app/packages/sdk/dist packages/sdk/dist

RUN pnpm install --frozen-lockfile --prod

EXPOSE 3000

# Migrations run automatically in startServer()
CMD ["node", "packages/server/dist/index.js"]
