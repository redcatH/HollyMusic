# Docker 部署指南（Prisma + SQLite）

## 📋 概览

本项目使用 **Prisma + SQLite** 进行数据库管理，Docker 部署已配置自动迁移。

### 关键问题解答

#### 1. 初始化数据库会自动完成吗？
✅ **会自动完成**
- SQLite 数据库文件会在 `/app/data/music.db` 自动创建
- 第一次启动时 Prisma 会建立表结构

#### 2. 迁移会自动完成吗？
✅ **会自动完成**（在启动脚本中）
```bash
pnpm prisma migrate deploy
```
- 此命令在容器启动时自动执行
- 它应用所有 `prisma/migrations/` 目录中的迁移文件
- 如果已应用过则跳过，避免重复执行

#### 3. 每次更新模型，迁移会自动生效吗？
✅ **会自动应用**（需满足以下条件）
- 在开发环境生成新迁移文件：
  ```bash
  pnpm prisma migrate dev --name <描述>
  ```
- 迁移文件被提交到 Git
- Docker 重启时自动执行 `prisma migrate deploy`

---

## 🚀 快速开始

### 本地开发

```bash
# 1. 开发环境创建/更新迁移
pnpm prisma migrate dev --name add_favorite_table

# 2. 启动开发服务器
pnpm dev

# 3. 查看数据库内容（可选）
sqlite3 ./data/music.db ".tables"
```

### Docker 部署

#### 方式 1：使用 Docker Compose（推荐）

```bash
# 构建并启动
docker-compose up -d

# 查看日志
docker-compose logs -f app

# 停止
docker-compose down

# 重启（自动执行迁移）
docker-compose restart app
```

#### 方式 2：手动 Docker 构建

```bash
# 构建镜像
docker build -t lx-music:latest .

# 运行容器
docker run -d \
  --name lx-music \
  -p 3000:3000 \
  -v music_db:/app/data \
  -e DATABASE_URL="file:./data/music.db" \
  lx-music:latest

# 查看日志
docker logs -f lx-music
```

---

## 📦 文件结构说明

```
project/
├── Dockerfile              # 包含自动迁移脚本的构建配置
├── docker-compose.yml      # 容器编排配置
├── .env.example            # 环境变量模板
├── .env                    # 实际环境变量（Docker 中需要挂载或注入）
├── prisma/
│   ├── schema.prisma       # Prisma 数据模型定义
│   └── migrations/         # 迁移历史（自动管理，需提交到 Git）
├── lib/
│   ├── db.ts               # Prisma 客户端 wrapper
│   └── generated/prisma/   # 自动生成的 Prisma 类型
└── data/
    └── music.db            # SQLite 数据库文件（Docker 卷持久化）
```

---

## 🔄 工作流程

### 添加新表或修改模型

#### 本地开发步骤

1. **修改 schema.prisma**
   ```prisma
   model NewTable {
     id      Int     @id @default(autoincrement())
     name    String
     createdAt DateTime @default(now())
   }
   ```

2. **生成迁移文件**
   ```bash
   pnpm prisma migrate dev --name add_new_table
   ```
   - 这会创建 `prisma/migrations/xxxxx_add_new_table/migration.sql`
   - 自动更新本地数据库

3. **验证迁移**
   ```bash
   pnpm prisma studio  # 可视化数据库浏览
   ```

4. **提交到 Git**
   ```bash
   git add prisma/migrations/
   git commit -m "feat: add new table"
   ```

#### Docker 部署步骤

1. **拉取最新代码**
   ```bash
   git pull
   ```

2. **重建镜像**
   ```bash
   docker-compose build
   ```

3. **重启容器**（自动执行迁移）
   ```bash
   docker-compose up -d
   ```

4. **验证**
   ```bash
   docker-compose logs app | grep "Running Prisma"
   ```

---

## 📝 环境变量配置

### .env 文件（生产环境）

```env
# 数据库配置
DATABASE_URL="file:./data/music.db"

# Node 环境
NODE_ENV=production

# 音频文件缓存开关（可选，默认开启）
# ENABLE_FILE_CACHE=false  # 设为 false 可关闭本地缓存，节省磁盘空间

# 其他配置（按需添加）
LOG_LEVEL=info
```

#### 文件缓存说明

**开启文件缓存（默认）：**
- 音频流会在后台异步保存到 `.cache/audio/` 目录
- 客户端立即获得播放流，不需要等待缓存完成
- 下次请求相同歌曲直接返回本地缓存（速度快）
- 缓存文件 7 天自动过期

**关闭文件缓存：**
```bash
ENABLE_FILE_CACHE=false
```
- 每次请求都从上游源获取音频
- 节省磁盘空间（适合云部署）
- 响应时间可能较长（取决于上游源速度）

### Docker 中使用

**方式 1：在 docker-compose.yml 中指定**
```yaml
environment:
  - DATABASE_URL=file:./data/music.db
```

**方式 2：使用 .env 文件（需在宿主机）**
```bash
docker-compose --env-file /path/to/.env up -d
```

**方式 3：使用 docker run -e**
```bash
docker run -e DATABASE_URL="file:./data/music.db" ...
```

---

## 🐛 常见问题

### Q1: 数据库文件在哪里？
A: 
- 本地开发：`./data/music.db`
- Docker 中：`/app/data/music.db`
- Docker 卷映射：`music_db` 卷内

查看卷位置：
```bash
docker volume inspect music_db
```

### Q2: 迁移失败怎么办？
A: 
```bash
# 查看日志
docker-compose logs app

# 强制重置数据库（危险操作！会删除所有数据）
docker-compose exec app pnpm prisma migrate reset

# 或手动删除卷
docker volume rm music_db
docker-compose up -d  # 重新创建
```

### Q3: 如何备份数据库？
A:
```bash
# 从 Docker 卷复制数据库文件
docker run --rm -v music_db:/data -v $(pwd):/backup alpine cp /data/music.db /backup/music.db.backup
```

### Q4: 生产环境需要什么特殊配置？
A:
- 使用 Docker 卷持久化数据库
- 配置备份策略（定期导出 music.db）
- 监控磁盘空间
- 如规模增大，考虑迁移到 PostgreSQL

---

## 🔐 数据持久化说明

### Docker Compose 卷配置

```yaml
volumes:
  music_db:        # 数据库文件持久化
  cache_data:      # 缓存持久化
  app_logs:        # 日志持久化
```

**删除容器但保留数据：**
```bash
docker-compose down       # 不删除卷
docker-compose down -v    # 删除卷（谨慎！）
```

---

## 📊 监控和日志

```bash
# 实时日志
docker-compose logs -f app

# 查看迁移执行状态
docker-compose logs app | grep "Prisma"

# 进入容器调试
docker-compose exec app sh

# 检查 SQLite 数据库
docker-compose exec app sqlite3 /app/data/music.db ".tables"
```

---

## ✅ 部署检查清单

- [ ] Dockerfile 已更新（包含迁移脚本）
- [ ] docker-compose.yml 配置了 `music_db` 卷
- [ ] `.env.example` 已创建
- [ ] `prisma/migrations/` 目录已提交到 Git
- [ ] 本地测试：`docker-compose up -d` 成功启动
- [ ] 验证数据库自动创建和迁移执行
- [ ] 日志中没有迁移错误

---

## 🔗 相关文档

- [Prisma Docs](https://www.prisma.io/docs/)
- [Prisma Migrate](https://www.prisma.io/docs/concepts/components/prisma-migrate)
- [Docker Docs](https://docs.docker.com/)
- [SQLite](https://www.sqlite.org/)
