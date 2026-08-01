#!/bin/sh
set -e

# 执行 Prisma 迁移
echo "Running Prisma migrations..."
pnpm prisma migrate deploy || echo "No pending migrations"

# 启动 Next.js 后端（只跑 API，监听 3001）
echo "Starting Next.js API backend on port 3001..."
PORT=3001 pnpm start &
NEXT_PID=$!

# 等待后端就绪
echo "Waiting for backend..."
for i in $(seq 1 30); do
  if wget --quiet --tries=1 --spider http://127.0.0.1:3001/api/health 2>/dev/null; then
    echo "Backend ready"
    break
  fi
  sleep 1
done

# 启动 nginx（前台运行，作为容器主进程）
echo "Starting nginx on port 3000..."
nginx -g "daemon off;" &
NGINX_PID=$!

# 任一进程退出则退出容器
wait -n $NEXT_PID $NGINX_PID
EXIT_CODE=$?

# 清理
kill $NEXT_PID $NGINX_PID 2>/dev/null || true
exit $EXIT_CODE
