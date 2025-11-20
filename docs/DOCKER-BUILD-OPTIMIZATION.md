# Docker 构建性能优化指南

## 问题说明
每次运行 `docker-compose up --build` 都会重新执行 `pnpm install`，导致构建很慢。

## 解决方案

### 1. ✅ 已实现：Docker 分层缓存优化

**原理**: Docker 按层构建，每层是一个缓存单位。如果层内容未变化，会使用缓存。

**优化方案**：
```dockerfile
# ❌ 不好：package 变化时也会缓存失效
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

# ✅ 好：分离 package 和源代码
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile      # 只在 lock 文件变化时重新执行
COPY . .                                # 源代码变化不影响上面的层
RUN pnpm build
```

**效果**：
- 仅修改源代码：**秒级构建**（跳过 npm install）
- 修改 pnpm-lock.yaml：**需要重新 install**（正常）

### 2. ✅ 已实现：优化构建上下文（.dockerignore）

减小发送给 Docker daemon 的文件，加快上下文传输：

```
❌ 包含无用文件：
- node_modules/      （文件多）
- .git/             （历史记录）
- .next/            （构建输出）

✅ 排除不必要文件，减小上下文大小
```

**优化效果**：
- 减少构建上下文大小 50-80%
- 加快文件传输速度

### 3. ✅ 已实现：使用 BuildKit 加速

```yaml
build:
  args:
    BUILDKIT_INLINE_CACHE: 1  # 启用缓存
```

**启用方式**：

**Linux/macOS**:
```bash
export DOCKER_BUILDKIT=1
docker-compose up --build
```

**Windows PowerShell**:
```powershell
$env:DOCKER_BUILDKIT=1
docker-compose up --build
```

## 构建时间对比

### 场景 1：仅修改源代码（最常见）
```
❌ 未优化：
  npm install:  2-5 分钟
  build:        1-2 分钟
  总计:         3-7 分钟

✅ 已优化：
  (从缓存读取)  10-20 秒
```

### 场景 2：修改 pnpm-lock.yaml
```
✅ 需要 npm install（正常）
  npm install:  2-5 分钟
  build:        1-2 分钟
```

## 使用建议

### 开发阶段
使用开发配置（热重载，无需重建）：
```bash
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up
```

### 快速迭代
只修改源代码时：
```bash
# 利用缓存，秒级构建
docker-compose up --build
```

### 清理缓存（如需完全重建）
```bash
# 删除镜像，清空缓存
docker-compose down --rmi all

# 完全重建
docker-compose up --build
```

### 预加载缓存（CI/CD 优化）
```bash
# 在 CI 中保存缓存
docker-compose build --no-cache

# 本地加载缓存
docker image load < image.tar
```

## 进一步优化选项

### 选项 1：使用 pnpm 缓存卷（推荐）
```dockerfile
RUN --mount=type=cache,target=/pnpm-store \
    pnpm install --frozen-lockfile \
    --prefer-offline \
    --store-dir=/pnpm-store
```

编辑 `docker-compose.yml`：
```yaml
build:
  cache_from:
    - type=local,src=path/to/cache
```

### 选项 2：使用离线模式
```dockerfile
RUN pnpm install --frozen-lockfile \
    --prefer-offline \
    --no-audit
```

### 选项 3：多层缓存（适合 CI/CD）
```bash
# 推送构建阶段缓存到 registry
docker buildx build \
  --cache-from=type=registry,ref=registry/lx-music:buildcache \
  --cache-to=type=registry,mode=max,ref=registry/lx-music:buildcache \
  -t registry/lx-music:latest .
```

## 监控构建性能

### 查看构建历史
```bash
docker image history lx-music-app:latest
```

### 分析缓存命中率
```bash
docker-compose build --verbose
```

### 测量构建时间
```bash
time docker-compose up --build
```

## 总结

| 优化项 | 效果 | 状态 |
|------|------|------|
| 分层缓存（package 分离） | ⭐⭐⭐⭐⭐ | ✅ 已实现 |
| 优化 .dockerignore | ⭐⭐⭐ | ✅ 已实现 |
| BuildKit 加速 | ⭐⭐⭐ | ✅ 已实现 |
| pnpm 离线缓存 | ⭐⭐ | 可选 |
| Registry 缓存 (CI/CD) | ⭐⭐⭐⭐ | 可选 |

**建议**：当前配置已足够，平时只修改源代码时构建速度会非常快！
