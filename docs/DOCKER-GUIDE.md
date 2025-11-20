# Docker 部署指南

## 快速开始

### 1. 生产环境部署

```bash
# 构建并启动所有服务
docker-compose up -d

# 查看日志
docker-compose logs -f app

# 停止服务
docker-compose down
```

应用将在 `http://localhost:3000` 可访问。

### 2. 开发环境部署

```bash
# 使用开发配置启动（包含热重载和管理工具）
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up

# 应用会在代码变化时自动重载
```

开发工具：
- Adminer（数据库管理）：`http://localhost:8080`
- Redis Commander（Redis 管理）：`http://localhost:8081`

## 服务架构

```
┌─────────────────────────────────────┐
│      LX Music App (Node.js/Next)    │ :3000
│  (cache_data, app_logs volumes)     │
└──────────────────┬──────────────────┘
                   │
        ┌──────────┼──────────┐
        │          │          │
    ┌───┴───┐  ┌───┴───┐  ┌──┴────┐
    │ Redis │  │PgSQL  │  │本地文件│
    │:6379  │  │:5432  │  │缓存   │
    └───────┘  └───────┘  └───────┘
```

## 网络配置

### 外部网络定义
- **网络名**: `music_network`
- **驱动**: bridge
- **子网**: 172.20.0.0/16
- **可用 IP 范围**: 172.20.0.2 - 172.20.255.254

### 服务 IP 分配
- App: 172.20.0.2:3000
- Redis: 172.20.0.3:6379
- PostgreSQL: 172.20.0.4:5432

### 服务间通信
容器内可以通过服务名相互访问：
```
app → redis:6379
app → postgres:5432
```

## 环境变量配置

### App 环境变量
```env
NODE_ENV=production
NEXT_PUBLIC_API_URL=http://localhost:3000
```

### Redis 配置
```
密码: redis_password
持久化: 启用 (appendonly yes)
```

### PostgreSQL 配置
```
用户: music_user
密码: music_password
数据库: music_db
```

## 数据持久化

### 卷挂载映射
| 卷名 | 用途 | 挂载路径 |
|------|------|--------|
| `cache_data` | 缓存文件 | `/app/data/cache` |
| `app_logs` | 应用日志 | `/app/logs` |
| `redis_data` | Redis 持久化 | `/data` |
| `postgres_data` | 数据库文件 | `/var/lib/postgresql/data` |

### 查看卷信息
```bash
# 列出所有卷
docker volume ls

# 查看卷详情
docker volume inspect lx-music-cache_data

# 手动清理卷
docker volume rm lx-music-cache_data
```

## 常见操作

### 查看容器状态
```bash
docker-compose ps
```

### 查看实时日志
```bash
docker-compose logs -f app
docker-compose logs -f redis
docker-compose logs -f postgres
```

### 进入容器 Shell
```bash
docker-compose exec app sh
docker-compose exec redis redis-cli
docker-compose exec postgres psql -U music_user -d music_db
```

### 重建镜像
```bash
# 强制重建（不使用缓存）
docker-compose build --no-cache

# 重建后启动
docker-compose up -d
```

### 清理未使用资源
```bash
# 删除停止的容器
docker container prune

# 删除未使用的卷
docker volume prune

# 完全清理
docker system prune -a
```

## 性能优化

### 1. 多阶段构建
Dockerfile 使用多阶段构建，减小最终镜像大小。

### 2. Redis 缓存
启用 Redis 提高缓存性能：
```typescript
// 在应用代码中
const redis = require('redis').createClient({
  host: 'redis',
  port: 6379,
  password: 'redis_password'
})
```

### 3. PostgreSQL 连接池
建议使用连接池库（如 pg-boss）管理数据库连接。

## 故障排查

### 健康检查失败
```bash
# 查看健康检查日志
docker-compose ps

# 手动检查应用
curl http://localhost:3000/api/health
```

### Redis 连接失败
```bash
# 进入 Redis 容器
docker-compose exec redis redis-cli

# 验证密码
> AUTH redis_password
OK
```

### PostgreSQL 连接超时
```bash
# 查看 PostgreSQL 日志
docker-compose logs postgres

# 检查网络连接
docker-compose exec app ping postgres
```

## 推荐做法

1. ✅ 使用 `.env` 文件管理敏感信息
2. ✅ 定期备份数据卷
3. ✅ 监控容器资源使用情况
4. ✅ 使用网络隔离提高安全性
5. ✅ 配置自动重启策略
6. ✅ 为生产环境使用专用反向代理（Nginx）

## 升级部署

```bash
# 拉取最新代码
git pull

# 重新构建镜像
docker-compose build

# 无停机更新
docker-compose up -d

# 验证更新
docker-compose logs -f app
```
