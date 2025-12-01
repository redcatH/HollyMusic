#!/bin/sh
set -e

# 执行 Prisma 迁移（如果有新的迁移文件）
echo "Running Prisma migrations..."
pnpm prisma migrate deploy || echo "No pending migrations"

# 启动应用
echo "Starting Next.js application..."
exec pnpm start
