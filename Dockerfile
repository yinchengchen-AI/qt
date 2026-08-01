# syntax=docker/dockerfile:1
# qt-biz 生产镜像 — 多阶段构建
#
# ~~~~~~~~~~~~~~~~~~~~~~~~~~~~ DEPRECATED ~~~~~~~~~~~~~~~~~~~~~~~~~~~~
# v0.17+ qt-app:latest 镜像已弃用。生产直接跑 native systemd
# (ops/qt-app.service),不再每部署 docker build。
#
# 本 Dockerfile 仅留作:
#   1. 历史参考 (deploy 14min 时代的实现)
#   2. 应急回退: 1 次 docker build -t qt-app:latest . 即可重生镜像
#
# 推荐: 不要重建。让 native systemd + .next/cache 吃 deploy 时长。
# 应急 (例如 native 整个起不来): docker build -t qt-app:latest . && docker compose up -d app
# ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
#
# 阶段:
#   deps   : npm ci + prisma generate (patch-package 在 postinstall 里应用 patches/)
#   build  : next build (standalone 产物; 不需要 DB, 页面全 dynamic)
#   runner : standalone + scripts 源码 + 全局 tsx/prisma CLI
#            (历史用法: migrate deploy / release:publish 以一次性容器命令跑 TS 源码)
#
# 构建 (DEPRECATED):
#   docker build --build-arg APP_VERSION="$(node -p 'require("./package.json").version')+$(git rev-parse --short HEAD)" -t qt-app:latest .

FROM node:22-alpine AS deps
WORKDIR /app
# apk 走阿里云源 (dl-cdn.alpinelinux.org 从 ECS 实测 ~250s, 换源后 ~10s)
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories && \
    apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
COPY patches ./patches
COPY prisma ./prisma
# npm 走 npmmirror CDN (官方源从 ECS 实测 8KB/s, CDN ~3.4MB/s);
# BuildKit 缓存挂载: lockfile 变化时只下载增量 tarball, 不随镜像层作废
RUN --mount=type=cache,target=/root/.npm \
    npm ci --legacy-peer-deps --no-audit --no-fund --registry=https://registry.npmmirror.com && \
    npx prisma generate

FROM node:22-alpine AS build
WORKDIR /app
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories && \
    apk add --no-cache libc6-compat
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG APP_VERSION
# 容器内无 .git,computeAppVersion() 回落到 NEXT_PUBLIC_APP_VERSION;
# SKIP_ENV_VALIDATION: build 收集页面数据会 import 路由模块(lib/env fail-fast),
# 镜像构建期没有真实环境变量,仅在构建阶段跳过校验(运行时不受影响)
ENV NEXT_PUBLIC_APP_VERSION=$APP_VERSION \
    NEXT_TELEMETRY_DISABLED=1 \
    SKIP_ENV_VALIDATION=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
# git: release:publish 需要跑 git log(.git 由 deploy.sh 以只读挂载注入);
# safe.directory: 挂载的 .git 属主与容器用户不同时 git 拒绝操作
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories && \
    apk add --no-cache libc6-compat curl git && \
    git config --system --add safe.directory /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=127.0.0.1

# 应用本体(standalone 的 server.js + .next)
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

# 完整 node_modules(含 devDeps 的 tsx / prisma CLI 及其依赖树)。
# 取舍:镜像体积 ~1.5-2GB 换一次性容器命令(migrate deploy / release:publish)
# 100% 可跑 — 曾尝试"standalone trace + 按需拷贝"但 prisma/config → effect 等
# 传递依赖难以枚举,脆弱;层缓存使 lockfile 不变时该层零成本,多版本 tag 共享底层。
COPY --from=build /app/node_modules ./node_modules

# release:publish 直接跑 TS 源码(scripts → @/lib → @/server),把源码与配置拷入
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/lib ./lib
COPY --from=build /app/server ./server
COPY --from=build /app/types ./types
COPY --from=build /app/tsconfig.json ./tsconfig.json

# prisma migrate deploy 需要 schema + migrations + prisma.config.ts
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/login" >/dev/null || exit 1

CMD ["node", "server.js"]
