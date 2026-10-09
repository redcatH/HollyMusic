# 本地开发与架构

[返回项目首页](../README.md)

只想部署使用时，直接阅读 [Docker 部署指南](DEPLOYMENT.md)。

## 技术栈

| 层 | 技术 |
|------|------|
| 前端 | Vite 6 + React 19 + React Router v7 + TypeScript 5 |
| 后端 | Next.js 16 (App Router, 仅 API 路由) |
| 样式 | Tailwind CSS v4 |
| 状态 | Zustand |
| 音频 | HTML5 Audio + Web Audio API（频谱）+ 服务端 Range 代理 |
| 数据库 | Prisma + SQLite |
| PWA | Service Worker + Web App Manifest + Media Session API |
| 部署 | Docker / Docker Compose（nginx 托管 SPA + 反代 API） |

## 目录与请求流向

```text
frontend/src/      Vite SPA：路由、页面、主题与布局
components/       播放器等共享 React 组件
hooks/            播放、搜索、歌词、歌单等 hooks
lib/api/          前端 API 客户端
lib/services/     服务端业务逻辑
app/api/          Next.js API 路由
app/rest/         Subsonic 协议入口
public/           PWA 图标、manifest.json、sw.js
prisma/           数据库 schema 与迁移
custom-sources/   本地音源脚本（不提交）
config/           本地音源配置与可选初始用户
lx-env-simulator/ 洛雪音源兼容层
```

浏览器通过前端调用 `/api`；开发时 Vite 代理到 Next.js，生产环境由 nginx 托管 SPA 并反代 API。`@/*` 指向仓库根目录，`@@/*` 指向 `frontend/src/`。

## 本地启动

### 环境要求
- Node.js 20+（与 CI、Docker 保持一致）
- pnpm 10（版本见根目录 `package.json` 的 `packageManager`）

### 1. 安装依赖

根目录与前端各需安装：

```bash
pnpm install
cd frontend && pnpm install && cd ..
```

### 2. 配置环境变量

在项目根创建 `.env`（可复制 `.env.example`）：

```env
DATABASE_URL=file:./prisma/data/music.db

# 鉴权密钥（生产必填，缺失时仅开发环境可用不安全 fallback）
# 生成：openssl rand -hex 32 或 node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
AUTH_SECRET=请替换为至少32位的随机字符串

# 音频磁盘缓存（服务端 Range 代理 + 边下边播）
ENABLE_FILE_CACHE=true
AUDIO_CACHE_QUOTA_GB=10
AUDIO_CACHE_MAX_CONCURRENT=5
# AUDIO_CACHE_DIR=/app/.cache/audio-cache   # Docker 建议
# 完整变量见 .env.example

# 可选：搜索/URL 内存缓存 TTL（默认 210 分钟）
# SEARCH_CACHE_TTL_MS=12600000
```

### 3. 初始化数据库

```bash
# 首次开发：应用仓库已有迁移，初始化本地数据库
pnpm prisma migrate dev

# 或快速同步 schema（不生成 migration 文件）
pnpm prisma db push

# 生成 Prisma Client（migrate 会自动生成，必要时手动执行）
pnpm prisma generate
```

> ⚠️ **拉取新代码后，本地启动前务必同步 DB schema**：
> ```bash
> pnpm prisma migrate dev     # 应用未执行的 migration（推荐）
> # 或 pnpm prisma db push    # 直接把 schema 推到本地 db（不记 migration 历史）
> ```
> 若本地 db 落后于代码 schema（如新增了列），Prisma 全量列查询会抛错并被 service 层 catch，导致 `/api/cover` 等接口**静默回退默认值**（封面全变默认图），且只在服务端日志报错、前端无感知。可用 `pnpm prisma migrate status` 检查是否有未应用的 migration。

### 4. 启动开发服务器

同时启动 Next.js API（3000）与 Vite 前端（5173）：

```bash
pnpm dev:all
```

- 前端：http://localhost:5173 （Vite dev server，自动代理 `/api` → 3000）
- 后端 API：http://localhost:3000

> 也可单独启动：`pnpm dev`（仅后端）、`pnpm dev:web`（仅前端，需后端在 3000 端口）

> **初始管理员**：首次启动会先导入存在的 `config/users.json`；若其中提供 `admin`，使用该密码且不在日志中输出。若文件不存在或未提供 `admin`，才会创建随机密码的 `admin` 并仅在服务端日志中显示一次。admin 用户名固定为 `admin`；用户通过 Web UI 改密后以数据库为准，重启不会回写覆盖。

## 提交前检查

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm -C frontend test
pnpm build
pnpm -C frontend build
```

保持现有 React、TypeScript 和 Tailwind 风格；日志使用 `logger`，缓存复用现有单例。音源兼容层改动需单独说明。

- [贡献与 PR 流程](../CONTRIBUTING.md)
- [VS Code 调试指南](DEBUG-GUIDE.md)
- [音源配置热重载](CONFIG-HOT-RELOAD.md)
- [仓库展示与截图维护](REPOSITORY-PRESENTATION.md)
