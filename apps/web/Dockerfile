# ---------- builder ----------
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

RUN pnpm install --filter @itamls/web... --frozen-lockfile=false

# The browser hits /api/v1 on the same origin in production (nginx proxies it).
ENV VITE_API_URL=/api/v1
WORKDIR /app/apps/web
RUN pnpm build

# ---------- runtime ----------
FROM nginx:alpine
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
