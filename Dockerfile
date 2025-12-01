# 构建阶段
FROM node:20-bullseye-slim AS builder

WORKDIR /app

# 配置 npm 使用国内镜像加速
RUN npm config set registry https://registry.npmmirror.com

# 使用 pnpm 作为包管理器
RUN npm install -g pnpm

# 复制 .npmrc 配置（如果存在）以使用国内镜像
COPY .npmrc* ./

# 先只复制 package 文件（利用 Docker 分层缓存）
# 如果 package.json 和 pnpm-lock.yaml 没有变化，此层会被缓存
COPY package.json pnpm-lock.yaml ./

# 安装依赖（此步骤会被缓存，除非 lock 文件变化）
RUN pnpm install --frozen-lockfile

# 再复制源代码和配置文件（源码变化不会重新执行 npm install）
COPY . .

# 确保必要的目录存在
RUN mkdir -p custom-sources config

# 生成 Prisma 客户端
RUN pnpm prisma generate

# 构建应用
RUN pnpm build

# 运行阶段
FROM node:20-bullseye-slim

WORKDIR /app

# 安装 pnpm
RUN npm install -g pnpm

# 复制 .npmrc 配置到运行镜像（可选，如需在运行时重新安装依赖）
COPY .npmrc* ./

# 从构建阶段复制构建结果
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/config ./config
COPY --from=builder /app/custom-sources ./custom-sources
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/lib/generated/prisma ./lib/generated/prisma

# 复制 builder 中的 public 目录到运行镜像，确保静态资源可访问
COPY --from=builder /app/public ./public

# 复制 .env.example 作为参考（实际使用时应挂载或注入 .env）
COPY .env.example .env.example

# 创建缓存和数据目录
RUN mkdir -p /app/data /app/logs

# 复制启动脚本到镜像并赋予执行权限
COPY scripts/start.sh /app/start.sh
RUN chmod +x /app/start.sh

# 暴露端口
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# 启动应用（执行迁移 + 启动服务）
CMD ["/app/start.sh"]