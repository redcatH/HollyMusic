# 部署与升级

[返回项目首页](../README.md)

提供两种方式：**拉预构建镜像**（推荐，无需源码）或**从源码构建**。

## 方式一：拉取预构建镜像（推荐，最快）

镜像通过 GitHub Actions 自动构建并推送至 ghcr.io，无需 clone 源码，按以下步骤即可启动。

**1. 创建部署目录并进入**

```bash
mkdir holly-music && cd holly-music
```

**2. 创建 `docker-compose.yml`**

直接下载仓库自带的示例文件（使用 ghcr.io 预构建镜像，各配置项说明见文件内注释）：

```bash
curl -o docker-compose.yml \
  https://raw.githubusercontent.com/redcatH/HollyMusic/main/docker-compose.example.yml
```

> 想固定版本？把 `image: ghcr.io/redcath/hollymusic:latest` 换成具体 tag，如 `:v0.27.1`（见 [releases](https://github.com/redcatH/HollyMusic/releases)）。

**3. 创建 `.env`**

```env
# 鉴权密钥（必填！≥32 位随机字符串）
# 生成：openssl rand -hex 32
#       或 node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
AUTH_SECRET=请替换为至少32位的随机字符串

# 可选：AI 功能（管理员 AI 推荐任务 + 用户 AI 协助建歌单）
# OPENAI_API_KEY=sk-xxx
# OPENAI_BASE_URL=https://api.openai.com/v1
```

**4. 启动**

```bash
docker compose up -d
```

可选：若希望预置管理员而不从日志读取随机密码，在启动前创建被忽略的 `config/users.json`：

```json
{
  "users": [
    { "username": "admin", "password": "请替换为强密码" }
  ]
}
```

启动后访问 http://localhost:3099 即可。若未预置 `admin`，初始密码会打印在容器日志中（仅显示一次，登录后强制改密）：

```bash
docker compose logs app | grep -i password
```

> 首次启动会自动在 `./prisma_data` 创建数据库并运行 Prisma 迁移，无需手动操作。

**或：使用 `docker run` 单命令启动（无需 compose / `.env` 文件）**

不想创建 `docker-compose.yml` 和 `.env`？也可以用一条 `docker run` 直接启动，所有参数通过 `-e` / `-v` 传入：

```bash
docker run -d \
  --name holly-music \
  -p 3099:3000 \
  -e NODE_ENV=production \
  -e DATABASE_URL=file:./prisma/data/music.db \
  -e ENABLE_FILE_CACHE=true \
  -e AUDIO_CACHE_DIR=/app/.cache/audio-cache \
  -e AUDIO_CACHE_QUOTA_GB=10 \
  -e AUTH_SECRET=$(openssl rand -hex 32) \
  -v "$(pwd)/custom-sources:/app/custom-sources" \
  -v "$(pwd)/config:/app/config" \
  -v "$(pwd)/prisma_data:/app/prisma/prisma/data" \
  -v "$(pwd)/cache_data:/app/.cache" \
  -v "$(pwd)/app_logs:/app/logs" \
  --health-cmd "wget --quiet --tries=1 --spider http://localhost:3000/api/health || exit 1" \
  --health-interval 30s --health-timeout 10s --health-retries 3 --health-start-period 15s \
  ghcr.io/redcath/hollymusic:latest
```

> - `AUTH_SECRET` 用 `$(openssl rand -hex 32)` 现场生成随机密钥（也可替换为自己固定的 ≥32 位字符串）。**注意：密钥一旦确定就不要再改**，否则已登录用户的 cookie 会全部失效。
> - 端口 `3099:3000` 左边是宿主机端口，按需修改；初始密码在容器日志中：`docker logs holly-music | grep -i password`。
> - 升级：`docker pull ghcr.io/redcath/hollymusic:latest && docker rm -f holly-music` 后重新执行上面的 `docker run`（数据通过 volume 保留）。

**HTTPS 部署（可选）**

- **HTTP 直连**（`http://IP:3099`）：无需额外配置，默认即可。
- **HTTPS 反代**（nginx/CDN 终止 TLS）：在 `.env` 中设置 `COOKIE_SECURE=true`，让登录 Cookie 仅通过 HTTPS 传输。

```env
# HTTPS 反代部署时取消注释
COOKIE_SECURE=true
```

> 注意：`COOKIE_SECURE` 默认 `false`，与 `NODE_ENV` 无关。HTTP 直连时**不要**设为 `true`，否则浏览器拒绝保存 `Secure` cookie，同样会导致"未登录"。

## 方式二：从源码构建

适合需要修改代码或自定义镜像的场景。clone 本仓库后，在根目录执行：

```bash
docker compose up --build -d
```

仓库自带的 `docker-compose.yml` 即采用此方式（`build: .`），配置项与方式一一致，区别仅在于镜像来源（根目录另有一份 `docker-compose.example.yml`，是直接使用 ghcr.io 镜像的部署示例）。

## 运行时架构说明

镜像采用**三阶段构建**（见 [`Dockerfile`](../Dockerfile)）：
1. `frontend-builder` — Vite 构建前端 SPA 产物到 `frontend/dist`
2. `backend-builder` — Next.js 构建 API
3. 运行时镜像 — `node:20-bullseye-slim` + nginx，复制两阶段产物

运行时架构（`scripts/start-spa.sh`）：
- Next.js API 监听 **3001**（仅容器内）
- nginx 监听 **3000**（对外），托管前端 SPA（`/usr/share/nginx/html`）并反代 `/api`、`/rest` 到 3001
- 健康检查：`GET /api/health`

## 持久化与配置

挂载目录（见 [`docker-compose.yml`](../docker-compose.yml)）：

| 宿主目录 | 容器路径 | 用途 |
|---------|---------|------|
| `./prisma_data` | `/app/prisma/prisma/data` | 数据库（**重要，勿丢**） |
| `./cache_data` | `/app/.cache` | 音频磁盘缓存 |
| `./config` | `/app/config` | 音源注册表 `music-sources.json`、初始用户 `users.json` |
| `./custom-sources` | `/app/custom-sources` | 自定义音源脚本（便于热更新） |
| `./app_logs` | `/app/logs` | 日志（可选） |

> 方式一首次启动时 `config/`、`custom-sources/` 等目录会自动创建为空。音源脚本可通过 admin Web UI 上传（见[配置自定义音源](USER-GUIDE.md#配置自定义音源)），或手动放入 `./custom-sources/` 并在 `./config/music-sources.json` 注册。

## 升级

```bash
docker compose pull        # 拉取最新镜像
docker compose up -d       # 重新创建容器（数据通过 volume 保留）
```

生产环境务必设置 `AUTH_SECRET` 环境变量（≥32 位随机字符串）。

## PWA 与反向代理

部署 PWA 需注意（以 nginx 为例）：

1. **HTTPS** — PWA 强制要求（Service Worker 仅在 HTTPS 或 localhost 下注册）
2. **`/manifest.json` 与 `/sw.js` 禁止缓存** — 确保浏览器能够及时检查更新（`nginx-spa.conf` 已配置）：
   ```nginx
   location = /manifest.json { add_header Cache-Control "no-cache"; }
   location = /sw.js { add_header Cache-Control "no-cache"; }
   ```
3. **静态资源强缓存** — Vite 构建产物 `/assets/` 带 hash，可一年强缓存（`/_next/static/` 同理）
4. **`viewport-fit=cover`** — 已在 `frontend/index.html` 配置，配合 `env(safe-area-inset-*)` 适配刘海屏

更新 Service Worker 后，记得更新 `public/sw.js` 中的缓存版本常量，旧缓存才会被清理。

备份、鉴权和故障排查见[运维指南](OPERATIONS.md)。

## Windows 与 NAS

README 中的命令示例使用 Bash。Windows 可在 WSL 中执行，或直接下载 [Compose 示例](../docker-compose.example.yml)，将其保存为部署目录中的 `docker-compose.yml`，再用文本编辑器创建 `.env`。

如果 NAS 的容器管理器支持 Compose 项目，可导入相同配置，并把 `.env` 放在项目目录。确保挂载目录对容器可写，再启动项目。端口默认为 `3099`，需要时修改端口映射左侧的宿主端口。

`.env` 至少包含 `AUTH_SECRET`。没有 OpenSSL、但已安装 Node.js 时，可运行以下命令生成随机值，复制到 `.env`：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

部署完成后从浏览器打开 `http://服务器地址:3099`，按 README 的首次登录步骤导入音源。后续重新创建容器时保留 `.env` 和所有数据挂载目录。
