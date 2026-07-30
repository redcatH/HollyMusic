我们的宗旨：利用网络上的一切资源，将白嫖进行到底！

Our motto: use all available resources on the internet to get everything for free!

This repository contains two localized READMEs. Choose the language you prefer:

- Chinese (Simplified): `README_zh.md`
- English: `README_en.md`

If you want a single-language README as the project root instead, tell me which language to keep and I will replace `README.md` with that language's content.
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

**调试与常见问题**
- 无法打开 DB：参考上面的迁移步骤与文件权限检查。Windows 下注意文件锁与权限；如果使用 Docker，避免同时由容器与本地进程并发写入同一 sqlite 文件。
- 音源脚本加载失败：检查 `config/music-sources.json` 的路径，或在日志中查看 `lib/music-source-manager.ts` 打印的初始化错误。
- 歌词 / 封面获取优先级：代码会先尝试本地已加载音源提供的接口（`getLyric`/`getPic`），若无结果再调用外部服务（例如 `api.lrc.cx`）作为回退。

**缓存管理**

搜索结果与播放 URL 会缓存到内存以降低重复请求。默认 TTL 为 210 分钟（可用环境变量 `SEARCH_CACHE_TTL_MS` 调整）。清理方式：

- **自动过期**：每条缓存到期后自动失效，后台每 5 分钟扫描清理一次。
- **重启服务**：内存缓存，重启容器即清空（`docker compose restart app`）。
- **手动调接口**（无需重启，立即生效）：

```bash
# 清理搜索缓存
curl -X POST https://<你的域名>/api/cache/clear \
  -H "Content-Type: application/json" \
  -d '{"type":"search"}'

# 清理所有缓存（搜索 + URL）
curl -X POST https://<你的域名>/api/cache/clear \
  -H "Content-Type: application/json" \
  -d '{"type":"all"}'
```

支持 `search` / `url` / `all` 三种类型。注意：若 nginx 强制 HTTP→HTTPS，请直接用 `https://` 或给 curl 加 `-L`。

**贡献指南**
- 请基于 `main` 分支创建 feature 分支。
- 每次提交专注一项变更，写明 commit message（示例：`feat(source): add new source for XYZ`）。
- 提交前运行 linter：`pnpm lint`。

**参考文档与目录**
- 项目中已有若干文档在 `docs/`，包含调试指南、音源脚本规范与构建说明，建议阅读 `docs/CONFIG-HOT-RELOAD.md` 与 `docs/SEARCH-GUIDE.md`。

---

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

**Development**

- **Prerequisites:** Install dependencies with `pnpm install` (recommended) or `npm install`.
- **Environment:** Copy or create `.env` in project root and set `DATABASE_URL`. Example:

	```text
	DATABASE_URL=file:./prisma/data/music.db
	```

- **Prisma (local dev database):** If you don't have a local SQLite yet, create/apply schema locally:

	```powershell
	# create migration and local db (interactive, recommended for development)
	npx prisma migrate dev --name init

	# or quickly sync schema to DB without generating migration
	npx prisma db push
	```

- **Generate Prisma Client:** (run automatically by migrations, or run manually)

	```bash
	npx prisma generate
	```

- **Run development server:**

	```bash
	pnpm dev
	# or
	npm run dev
	```

- **Notes on database persistence:**
	- This project uses a file-based SQLite DB located by default at `prisma/data/music.db`.
	- When running in Docker, `docker-compose.yml` mounts a host folder `./prisma_data` into the container path `/app/prisma/data` so the container will persist the DB file. Locally the process resolves `file:./prisma/data/music.db` relative to the project working directory.
	- If you see `Error code 14: Unable to open the database file`, check that `prisma/data/music.db` exists, your `DATABASE_URL` is correct, and no other process (or Docker container) is locking the file. You can re-create the DB locally with the `prisma migrate` commands above.

**Docker / Production**

- Build and run with Docker Compose (uses Debian-based image for Prisma compatibility):

	```bash
	docker-compose up --build -d
	```

- The Docker image will run migrations or deploy steps defined in `scripts/start.sh` (if present). The compose file mounts `./prisma_data` on the host to `/app/prisma/data` inside the container. Ensure the host folder exists and is writable.

**Other useful commands**

- Lint:

	```bash
	pnpm lint
	```

- Build:

	```bash
	pnpm build
	```

**Cache management**

Search results and play URLs are cached in memory to reduce repeated requests. Default TTL is 210 minutes (configurable via `SEARCH_CACHE_TTL_MS`). Ways to clear:

- **Auto expiry**: each entry expires after TTL; a background sweep runs every 5 minutes.
- **Restart**: it is an in-memory cache, so restarting the container clears it (`docker compose restart app`).
- **Manual API** (no restart, immediate):

	```bash
	# Clear search cache
	curl -X POST https://<your-domain>/api/cache/clear \
	  -H "Content-Type: application/json" \
	  -d '{"type":"search"}'

	# Clear all caches (search + url)
	curl -X POST https://<your-domain>/api/cache/clear \
	  -H "Content-Type: application/json" \
	  -d '{"type":"all"}'
	```

	Supported types: `search` / `url` / `all`. If nginx enforces HTTP→HTTPS, use `https://` directly or add `-L` to curl.


## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
