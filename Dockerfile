# ============ 阶段 1: 构建前端（Vite SPA） ============
FROM node:20-bullseye-slim AS frontend-builder

WORKDIR /app

RUN npm config set registry https://registry.npmmirror.com && npm install -g pnpm

# 先复制根 package 文件（用于复用根目录的 components/hooks/lib）
COPY package.json pnpm-lock.yaml ./
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml frontend/

# 安装根依赖（前端通过 @/* 别名引用根目录的 components/hooks/lib）
RUN pnpm install --frozen-lockfile

# 安装前端依赖
RUN cd frontend && pnpm install --frozen-lockfile

# 复制源码
COPY . .

# 构建前端
RUN cd frontend && pnpm build

# ============ 阶段 2: 构建后端（Next.js API） ============
FROM node:20-bullseye-slim AS backend-builder

WORKDIR /app

RUN npm config set registry https://registry.npmmirror.com && npm install -g pnpm

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm prisma generate
RUN pnpm build

# ============ 阶段 3: 运行时（nginx + Node.js） ============
FROM node:20-bullseye-slim

# 安装 nginx
RUN apt-get update && apt-get install -y nginx && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN npm install -g pnpm

# 从后端构建阶段复制
COPY --from=backend-builder /app/.next ./.next
COPY --from=backend-builder /app/node_modules ./node_modules
COPY --from=backend-builder /app/package.json ./package.json
COPY --from=backend-builder /app/config ./config
COPY --from=backend-builder /app/custom-sources ./custom-sources
COPY --from=backend-builder /app/prisma ./prisma
COPY --from=backend-builder /app/lib/generated/prisma ./lib/generated/prisma

# 从前端构建阶段复制静态文件
COPY --from=frontend-builder /app/frontend/dist /usr/share/nginx/html

# 复制 public 资源（SW、manifest、图标）到 nginx 静态目录
COPY --from=frontend-builder /app/frontend/public /usr/share/nginx/html/

# 复制 nginx 配置
COPY nginx-spa.conf /etc/nginx/conf.d/default.conf

# 复制启动脚本
COPY scripts/start-spa.sh /app/start-spa.sh
RUN chmod +x /app/start-spa.sh

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["/app/start-spa.sh"]
