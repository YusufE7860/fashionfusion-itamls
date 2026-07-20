# ---------- builder ----------
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app

# Workspace metadata
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
# Source
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
COPY tools ./tools

# Install all workspace deps
RUN pnpm install --filter @itamls/api... --frozen-lockfile=false

# Generate Prisma client + build TS
WORKDIR /app/apps/api
RUN pnpm exec prisma generate
RUN pnpm build

# ---------- runtime ----------
FROM node:20-alpine
# openssl for prisma, git+docker-cli for the in-app self-updater
RUN apk add --no-cache openssl tini git docker-cli
# Install pnpm so we can run migrations / seed at runtime
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app
COPY --from=builder /app /app
ENV NODE_ENV=production
EXPOSE 4000
WORKDIR /app/apps/api
ENTRYPOINT ["/sbin/tini","--"]
CMD ["node","dist/main.js"]
