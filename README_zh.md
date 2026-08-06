**我们的宗旨：利用网络上的一切资源，将白嫖进行到底！**

**HollyMusic — 本地/自托管的音乐聚合服务**

一个基于 Next.js + TypeScript 的音乐聚合前端（兼顾 Subsonic API），目的是整合多个第三方音源脚本，并提供统一的播放/下载/元数据（封面、歌词）访问接口。

核心特点：
- 支持多音源插件（放在 `custom-sources/`），通过内嵌的 `LXEnvironmentSimulator` 运行音源脚本并统一调用。
- 使用 Prisma + SQLite 保存部分持久化数据（例如 `MusicInfo`, `User`, `Favorite`）。
- 提供 Subsonic 兼容的路由（metadata、cover、lyrics、stream 等），方便第三方客户端集成。
- 支持 Docker 化部署并保留数据卷以实现持久化。

**目录概览**
- `app/`：Next.js App Router 页面与 API 路由（服务器端入口）。
- `components/`：UI 组件（player、search、layout 等）。
- `lib/`：后端/业务逻辑核心（请求封装、音源管理、Prisma 客户端封装、日志、缓存等）。
- `hooks/`：前端常用 hooks（`useAudio`、`useSearch` 等）。
- `custom-sources/`：第三方或自定义音源脚本（JS），每个脚本实现一套约定接口。
- `prisma/`：Prisma schema、migrations 与默认的 `prisma/data/music.db`（SQLite）。
- `lx-env-simulator/`：兼容层（运行并封装第三方脚本，保持与旧项目的兼容）。

**快速开始（本地开发）**

1. 克隆并安装依赖

```powershell
pnpm install
# 或者
npm install
```

2. 环境变量

在项目根创建 `.env`（可复制 `.env.example` 或参照下例）：

```text
DATABASE_URL=file:./prisma/data/music.db
# AI 功能（管理员 AI 推荐任务 + 用户 AI 协助建歌单），详见 .env.example
OPENAI_API_KEY=sk-xxx
# 可选：OPENAI_BASE_URL / OPENAI_MODEL（OpenAI 兼容服务均可）
# 其它可选项：PORT, NODE_ENV 等
```

3. 初始化本地数据库（建议）

如果这是第一次在本地开发，请执行：

```powershell
# 交互式创建 migration 并生成本地 db（开发时推荐）
npx prisma migrate dev --name init

# 或者直接同步 schema（非生产迁移，仅把 schema 推到 db）
npx prisma db push

# 生成 Prisma Client（通常 migrate 会自动生成）
npx prisma generate
```

4. 启动开发服务器

```powershell
pnpm dev
# 或 npm run dev
```

打开 http://localhost:3000

注意：本地开发不会像容器那样自动执行容器启动脚本内的 deploy/migrate，如果你遇到 `Error code 14: Unable to open the database file`，请确认：
- `.env` 中 `DATABASE_URL` 指向的路径存在且可写（相对路径以项目根为准）
- 没有其他进程或容器锁定该 sqlite 文件（如果你同时运行容器请先停止容器）

**Docker（推荐用于生产/测试部署）**

项目包含 `Dockerfile` 与 `docker-compose.yml`：

```powershell
docker-compose up --build -d
```

注意：compose 文件将宿主目录的 `./prisma_data` 挂载到容器内的 `/app/prisma/data`，以保证数据库文件持久化。如果需要与本地开发共享同一 DB，请确保挂载路径正确并提前创建目录。

**自定义音源（开发与扩展）**

- 新增音源脚本：将 JS 脚本放入 `custom-sources/`，并在 `config/music-sources.json` 中注册（参照现有示例）。
- 音源脚本应遵循项目内 `lx-env-simulator` 的约定（实现 `musicSearch`, `musicInfo`, `lyric`, `pic`, `musicUrl` 等函数），项目通过 `lib/music-source-manager.ts` 动态加载并调用这些方法。

**AI 功能（可选）**

内置两个 AI 辅助功能，均走 OpenAI 兼容接口（`/chat/completions`），由 `OPENAI_API_KEY` 驱动：

- **管理员 AI 推荐任务**（后台 `/admin/recommend`）：批量按歌手/歌曲筛选入库，写入推荐白名单。前端可临时填 key，未填时回退到服务端 `OPENAI_API_KEY`。
- **AI 协助建歌单**（用户侧 `/playlists` →「AI 建歌单」）：所有登录用户可用。描述需求 → AI 生成候选 → 搜索真实歌曲 → AI 过滤多版本 → 用户确认 → 创建歌单。**强制使用服务端 `OPENAI_API_KEY`，不向用户暴露**；只搜后台已启用的音源。

在 `.env` 配 `OPENAI_API_KEY`（必需）、可选 `OPENAI_BASE_URL`（默认 `https://api.openai.com/v1`，可指向 DeepSeek / 通义 / 本地 LMDeploy 等 OpenAI 兼容服务）、可选 `OPENAI_MODEL`（默认 `gpt-4o-mini`）。未配置时：管理员任务需在前端填 key、用户 AI 建歌单不可用（提示未配置）。

> AI 建歌单面向所有登录用户，调用成本由服务端承担；公网部署建议自行加 per-user 频率限制。

**调试与常见问题**
- 无法打开 DB：参考上面的迁移步骤与文件权限检查。Windows 下注意文件锁与权限；如果使用 Docker，避免同时由容器与本地进程并发写入同一 sqlite 文件。
- 音源脚本加载失败：检查 `config/music-sources.json` 的路径，或在日志中查看 `lib/music-source-manager.ts` 打印的初始化错误。
- 歌词 / 封面获取优先级：代码会先尝试本地已加载音源提供的接口（`getLyric`/`getPic`），若无结果再调用外部服务（例如 `api.lrc.cx`）作为回退。

**贡献指南**
- 请基于 `main` 分支创建 feature 分支。
- 每次提交专注一项变更，写明 commit message（示例：`feat(source): add new source for XYZ`）。
- 提交前运行 linter：`pnpm lint`。

**参考文档与目录**
- 项目中已有若干文档在 `docs/`，包含调试指南、音源脚本规范与构建说明，建议阅读 `docs/CONFIG-HOT-RELOAD.md` 与 `docs/SEARCH-GUIDE.md`。
