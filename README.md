# 🎵 Holly Music

> 多源在线音乐聚合播放器 · 自部署 · PWA · 移动端友好

我们的宗旨：利用网络上的一切资源，将白嫖进行到底！

Holly Music 聚合多个音源（QQ / 网易 / 酷我 / 酷狗 / 咪咕等），提供统一的搜索、播放、收藏、歌单、歌词、下载体验。支持 PWA 安装到桌面、离线 App Shell、锁屏媒体控制。纯自部署，数据掌握在自己手里。

---

## ✨ 主要特性

### 🎧 播放体验
- **多源聚合**：一个搜索框，同时检索多个音源，质量回退（`flac24bit → flac → 320k → 128k`）
- **服务端磁盘缓存 + 边下边播**：音频在服务端落盘并支持 HTTP Range，浏览器原生 seek / 暂停 / 恢复；多用户共享缓存，LRU 自动清理；上游不支持 Range 也能正常跳转
- **失败自动跳歌**：某首拉取 500 / 解码失败时自动跳下一首，连续失败保护防止死循环
- **音源热重载**：`config/music-sources.json` 变更自动检测 MD5，无需重启

### 📱 移动端 & PWA
- **响应式布局**：大屏侧边栏常驻，小屏自动切换顶部导航栏 + 抽屉式菜单
- **PWA 可安装**：添加到主屏幕，像原生 App 一样打开（无浏览器地址栏）
- **Service Worker 离线壳**：断网时 App Shell 仍能打开
- **Media Session 锁屏控制**：锁屏 / 通知栏 / 耳机线控显示歌名、歌手、封面 + 播放/暂停/上下首按钮
- **刘海屏安全区适配**：`env(safe-area-inset-*)` + `viewport-fit=cover`，全面屏不遮挡按钮
- **歌词沉浸布局**：全屏歌词页，顶部极简下拉箭头 + 底部迷你播放条

### 🔐 用户系统
- **多用户隔离**：收藏、歌单、播放历史按用户隔离
- **用户管理**（仅 admin）：新增 / 编辑 / 删除用户，admin 账户与当前登录用户受保护
- **签名 Cookie 鉴权**：HMAC-SHA256 签名，防伪造

### 🔧 工程能力
- **音源热重载**：`config/music-sources.json` 变更自动检测 MD5，无需重启
- **内存缓存**：搜索结果与播放 URL 缓存（默认 TTL 210 分钟）
- **Subsonic 协议兼容**：可作为 Subsonic 服务端被外部客户端访问
- **Docker 一键部署**：含 Prisma 自动迁移

---

## 🛠 技术栈

| 层 | 技术 |
|------|------|
| 框架 | Next.js 16 (App Router) + React 19 + TypeScript 5 |
| 样式 | Tailwind CSS v4 |
| 状态 | Zustand |
| 音频 | Howler.js (html5 模式) + 服务端 Range 代理 |
| 数据库 | Prisma + SQLite |
| PWA | Service Worker + Web App Manifest + Media Session API |
| 部署 | Docker / Docker Compose |

---

## 📂 目录结构

```
├── app/                    # Next.js App Router 页面与 API 路由
│   ├── api/                # 后端 API（auth/proxy/music-url/lyrics/admin...）
│   ├── admin/users/        # 用户管理页面（仅 admin）
│   ├── favorites/          # 收藏页
│   ├── history/            # 播放历史
│   ├── playlists/          # 歌单
│   └── search/             # 搜索页
├── components/             # UI 组件
│   ├── layout/             # 布局（AppShell/Sidebar/MobileHeader）
│   ├── player/             # 播放器（PlayerBar/PlayerControls/LyricsPanel/QueuePanel）
│   ├── shared/             # 通用组件（CoverImage/SongRow/LoadingSkeleton...）
│   └── playlists/          # 歌单管理弹窗
├── hooks/                  # React Hooks
│   ├── useAudioPlayer.ts   # Howler 引擎封装（服务端 Range 代理）
│   ├── useMediaSession.ts  # 锁屏媒体控制
│   ├── useDownload.ts      # 下载（带进度）
│   ├── useSearch.ts        # 搜索
│   ├── useLyrics.ts        # 歌词
│   └── useRandomSongs.ts   # 发现音乐（带 TTL 缓存）
├── lib/                    # 业务核心
│   ├── services/           # 服务层（auth/user-service/playlist-service...）
│   ├── store/              # Zustand stores（player/favorites/discover）
│   ├── api/                # 前端 API 客户端
│   ├── music-source-manager.ts  # 音源管理与热重载
│   ├── cache-manager.ts    # 内存缓存
│   └── logger.ts           # 日志
├── custom-sources/         # 自定义音源脚本（见下文）
├── config/music-sources.json  # 音源注册表
├── prisma/                 # Prisma schema 与 migrations
├── public/                 # 静态资源（图标/manifest/sw.js）
└── lx-env-simulator/       # 兼容层（慎改）
```

---

## 🚀 快速开始

### 环境要求
- Node.js 18+
- pnpm（推荐）或 npm

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置环境变量

在项目根创建 `.env`（可复制 `.env.example`）：

```env
DATABASE_URL=file:./prisma/data/music.db
# AUTH_SECRET=<至少 32 位的随机字符串，生产必填，默认有 fallback 仅限开发>
# SEARCH_CACHE_TTL_MS=12600000   # 可选，缓存 TTL（默认 210 分钟）
```

### 3. 初始化数据库

```bash
# 首次开发：创建 migration 并生成本地 db
npx prisma migrate dev --name init

# 或快速同步 schema（不生成 migration 文件）
npx prisma db push

# 生成 Prisma Client（migrate 会自动生成，必要时手动执行）
npx prisma generate
```

### 4. 启动开发服务器

```bash
pnpm dev
```

打开 http://localhost:3000

> **默认管理员**：首次登录需在 `config/users.json`（或通过 `getOrCreateUserByName` 自动创建）配置 admin 账号的密码。admin 用户名固定为 `admin`。

---

## 🐳 Docker 部署（推荐生产）

```bash
docker-compose up --build -d
```

- `docker-compose.yml` 将宿主 `./prisma_data` 挂载到容器 `/app/prisma/data`，保证数据库持久化
- 容器启动脚本（`scripts/start.sh`）自动执行 Prisma 迁移
- 生产环境务必设置 `AUTH_SECRET` 环境变量（≥32 位随机字符串）

---

## 🎼 自定义音源

**方式一：Web UI 管理（推荐，admin 专属）**

admin 登录后，侧边栏头像下拉 →「音源管理」：
- 上传 `.js` 脚本（自动预校验 + 注册到 `music-sources.json`）
- 启停 / 编辑优先级 / 配置支持平台 / 删除（含关联脚本文件）

**方式二：手动编辑文件**

1. 将音源 JS 脚本放入 `custom-sources/`
2. 在 `config/music-sources.json` 注册（参照现有示例）
3. 脚本需实现约定接口（遵循 `lx-env-simulator` 规范）：
   - `musicSearch` — 搜索
   - `musicInfo` — 歌曲详情
   - `lyric` — 歌词
   - `pic` — 封面
   - `musicUrl` — 播放地址

音源支持**热重载**：`MusicSourceManager` 每次请求检查配置文件 MD5，变更自动重载，无需重启。

---

## 🔌 API 概览

| 路径 | 方法 | 说明 | 鉴权 |
|------|------|------|------|
| `/api/auth/login` | POST | 登录 | 公开 |
| `/api/auth/logout` | POST | 登出 | 公开 |
| `/api/auth/me` | GET | 当前会话 | 公开 |
| `/api/search` | GET | 搜索 | 公开 |
| `/api/music-url` | POST | 获取播放地址 | 公开 |
| `/api/lyrics` | GET | 获取歌词 | 公开 |
| `/api/audio` | GET/HEAD | 音频流 serve（磁盘缓存 + Range + 边下边播） | 公开 |
| `/api/proxy/[...path]` | GET | 通用流式代理（Subsonic / 下载用） | 公开 |
| `/api/cover/[id]` | GET | 封面代理 | 公开 |
| `/api/download` | GET | 下载代理（含进度） | 需登录 |
| `/api/history` | GET/POST | 播放历史 | 需登录 |
| `/api/favorites` | GET/POST | 收藏 | 需登录 |
| `/api/playlists` | GET/POST | 歌单 CRUD | 需登录 |
| `/api/admin/users` | GET/POST | 用户管理 | **仅 admin** |
| `/api/admin/users/[id]` | GET/PUT/DELETE | 单用户操作 | **仅 admin** |
| `/api/admin/sources` | GET/POST | 音源配置管理 | **仅 admin** |
| `/api/admin/sources/[id]` | PUT/DELETE | 单音源操作（含关联脚本） | **仅 admin** |
| `/api/admin/sources/upload` | POST | 上传音源脚本（预校验+自动注册） | **仅 admin** |
| `/api/cache/clear` | POST | 清理缓存 | 公开 |

统一响应格式：`{ success: boolean, data?: T, error?: { code, message } }`

---

## 🧹 缓存管理

搜索结果与播放 URL 缓存在内存中，降低重复请求。默认 TTL 210 分钟（可由 `SEARCH_CACHE_TTL_MS` 调整）。

清理方式：

```bash
# 清理搜索缓存
curl -X POST https://<你的域名>/api/cache/clear \
  -H "Content-Type: application/json" \
  -d '{"type":"search"}'

# 清理全部缓存（搜索 + URL）
curl -X POST https://<你的域名>/api/cache/clear \
  -H "Content-Type: application/json" \
  -d '{"type":"all"}'
```

支持 `search` / `url` / `all` 三种类型。若 nginx 强制 HTTP→HTTPS，请直接用 `https://` 或给 curl 加 `-L`。

---

## 📱 PWA 配置要点

部署 PWA 需注意（以 nginx 为例）：

1. **HTTPS** — PWA 强制要求（Service Worker 仅在 HTTPS 或 localhost 下注册）
2. **`/manifest.json` 与 `/sw.js` 禁止缓存** — 否则用户永久卡在旧版本：
   ```nginx
   location = /manifest.json { add_header Cache-Control "no-cache"; }
   location = /sw.js { add_header Cache-Control "no-cache"; }
   ```
3. **静态资源强缓存** — `/_next/static/` 带 hash，可一年强缓存
4. **`viewport-fit=cover`** — 已在 `app/layout.tsx` 配置，配合 `env(safe-area-inset-*)` 适配刘海屏

更新 Service Worker 后，记得递增 `public/sw.js` 中的 `VERSION` 常量，旧缓存才会被清理。

---

## 🛡 安全说明

- **密码存储**：当前为明文（`User.subsonicSecret`），与 Subsonic 协议的 `md5(secret+s)` 校验兼容。DB 文件务必做好权限控制。
- **鉴权**：签名 Cookie（HMAC-SHA256），生产环境必须设置 `AUTH_SECRET`（≥32 位）
- **用户管理保护**：admin 账户不可删除/改用户名，禁止删除当前登录用户，后端 `requireAdmin()` 强校验

---

## 🤝 贡献指南

- 基于 `main` 分支创建 feature 分支
- 每次提交专注一项变更，commit message 遵循约定式提交（`feat(scope): xxx` / `fix(scope): xxx`）
- 提交前运行 linter：`pnpm lint`
- 不要随意修改 `lx-env-simulator/` 与 `lx-music-desktop-master/` 的核心逻辑

---

## 📜 常见问题

**Q：无法打开数据库（`Error code 14: Unable to open the database file`）？**
A：检查 `.env` 中 `DATABASE_URL` 路径存在且可写；确认无其他进程锁定 SQLite 文件（Docker 与本地勿并发写同一文件）。

**Q：音源加载失败？**
A：检查 `config/music-sources.json` 路径，查看 `lib/music-source-manager.ts` 打印的初始化日志。

**Q：iOS PWA 顶部按钮被状态栏遮挡？**
A：确认顶部组件有 `safe-area-top` 类，且 `layout.tsx` 配置了 `viewportFit: "cover"`。iOS 可能缓存旧 meta 配置，需删除主屏图标重新添加。

**Q：播放/暂停/切歌从头播放？**
A：v0.8.0 起已改为服务端磁盘缓存 + Range 代理方案，seek / 暂停 / 恢复均由服务端响应，不再有此问题。若仍有异常，检查 `.env` 的 `ENABLE_FILE_CACHE` 是否为 `true`，以及服务端日志是否有 `[AudioCache]` 相关错误。

---

## 📄 License

本项目仅供学习交流使用，不得用于商业目的。请遵守当地版权法律法规。
