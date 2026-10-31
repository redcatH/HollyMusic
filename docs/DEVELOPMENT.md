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

### 首页页面缓存

`frontend/src/components/CachedHomePage.tsx` 在首次访问首页后保留组件和独立滚动容器，离开时隐藏，返回同一首页地址时保留数据、榜单展开状态和滚动位置，不重新请求数据。隐藏期间冻结首页路由上下文，并禁止搜索防抖修改当前页面地址；首页筛选参数变化或手动刷新时正常请求。缓存仅在当前应用会话内有效，账号变化、进入离线模式或退出应用布局时销毁，浏览器刷新后重新加载。

### 通用弹框与遮罩

通用弹框使用 `components/shared/Modal.tsx`，缓存设置和外观设置已接入。组件基于原生 dialog top layer，内部使用独立 `ModalMask`，业务无需调用 `showModal()`、处理遮罩点击或自行锁定页面滚动。

```tsx
<Modal open={open} onClose={() => setOpen(false)} title="设置" size="md"
  closeDisabled={saving}
  footer={<button onClick={save} disabled={saving}>保存</button>}
>
  <SettingsForm />
</Modal>
```

- 必填：`open`、`onClose`、`title`、`children`。`onClose` 是关闭请求，业务负责将 `open` 设为 false。
- 内容：`description`、`eyebrow`、`footer`；尺寸 `sm / md / lg / xl`；样式可通过 `className` 和 `bodyClassName` 调整。
- 关闭：`closeOnMaskClick`、`closeOnEscape` 默认 true；`closeDisabled` 统一禁用遮罩、Escape 和关闭按钮。自定义页脚按钮仍由业务维护 disabled。
- 焦点：默认聚焦关闭按钮，也可传稳定的 `initialFocusRef`；Tab 在弹框内循环，关闭后恢复之前的焦点；键盘事件不会触发播放器快捷键。
- 移动端：四边安全区留白，正文区域独立滚动，标题和页脚保持可见；跟随 Visual Viewport 调整软键盘下的高度与偏移。
- 滚动：使用独立 body 样式和计数锁，嵌套弹框关闭内层时保留滚动锁；最后一层关闭后恢复页面位置，不覆盖其他组件的 inline overflow。

支持点击遮罩关闭的弹窗、抽屉、底部操作面板，统一使用 `components/shared/ModalMask.tsx`，通过 `onClose` 传入关闭操作；`closeOnMaskClick` 默认 `true`，设为 `false` 时禁用点击遮罩关闭。原生 `<dialog>` 使用 `hooks/useMaskClickClose.ts` 返回的事件属性，第二个参数同样是 `closeOnMaskClick`，默认 `true`。不要直接给遮罩绑定关闭用的 `onClick`，也不要额外用 `mousedown` 提前关闭同一个面板。

共享逻辑通过捕获阶段记录同一指针在背景上的按下和松开；从内容区选中文字拖到背景、从背景拖入内容区、指针取消均不关闭。原生 dialog 还会排除内部空白区域。关闭按钮、取消、Escape 及提交期间的业务限制由各弹窗保留。

## 本地启动

### 环境要求
- Node.js 24 LTS（与 CI、Docker 保持一致）
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

# 自动化环境：仅应用已有迁移
pnpm prisma migrate deploy

# 生成 Prisma Client（migrate 会自动生成，必要时手动执行）
pnpm prisma generate
```

> ⚠️ **拉取新代码后，本地启动前务必同步 DB schema**：
> ```bash
> pnpm prisma migrate dev     # 应用未执行的 migration（推荐）
> ```
> 首次设置状态由迁移写入，不能只用 `prisma db push` 创建表。缺少初始化记录时服务会拒绝开放首次设置，避免把历史实例误判为空库。
> 若本地 db 落后于代码 schema（如新增了列），Prisma 全量列查询会抛错并被 service 层 catch，导致 `/api/cover` 等接口**静默回退默认值**（封面全变默认图），且只在服务端日志报错、前端无感知。可用 `pnpm prisma migrate status` 检查是否有未应用的 migration。

### 4. 启动开发服务器

同时启动 Next.js API（3000）与 Vite 前端（5173）：

```bash
pnpm dev:all
```

- 前端：http://localhost:5173 （Vite dev server，自动代理 `/api` → 3000）
- 后端 API：http://localhost:3000

> 也可单独启动：`pnpm dev`（仅后端）、`pnpm dev:web`（仅前端，需后端在 3000 端口）

> **初始管理员**：先应用数据库迁移，再运行 `pnpm dev:all`。新空库在网页为固定账号 `admin` 设置密码，完成后自动登录；迁移自动将已有管理员标记为初始化完成。显式 `config/users.json` 继续支持预置账户，已有账户密码以数据库为准，重启不会覆盖。通用设置由 `lib/services/system-settings.ts` 统一校验与读写；初始化记录只能由专用流程维护。`music.enabledPlatforms` 等键为后续功能提供存储能力，本次仍由现有音源配置驱动平台行为。

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

## Docker 多架构发布

发布配置见 [docker-publish.yml](../.github/workflows/docker-publish.yml)。流程为：

1. 按[维护者发布指南](releasing.md)运行 `pnpm release:prepare <version>`，先通过 PR 合并版本号与说明，等待对应 main CI 成功后再推送 tag。不要复用或移动已发布的版本 tag。
2. GitHub Actions 分别使用 `ubuntu-24.04` 和 `ubuntu-24.04-arm` 原生构建 `linux/amd64`、`linux/arm64`。每个平台独立安装依赖、生成 Prisma 引擎并构建，不跨架构复用 `node_modules` 或 standalone 产物。
3. 两个平台分别运行 `scripts/test-docker-setup.mjs`，验证 nginx SPA、API、数据库迁移、首次设置、会话和重启，再上传各自的 `build-<run_id>-<arch>` 暂存镜像。
4. 两边均通过后，合并镜像清单并检查平台列表，发布不可覆盖的版本标签。预发布仅向更高版本推进 `preview`，正式版仅向更高版本推进 `latest`；任一构建或容器测试失败都不会发布这些标签。
5. 镜像清单发布成功后，才创建 GitHub Release。ARM64 用户可先用预发布验证拉取、启动、搜索和播放，正式镜像发布并确认部署正常后再关闭相关 issue。

`workflow_dispatch` 的“手动运行”仍然只补发 GitHub Release，**不会构建镜像或补上 ARM64 清单**。旧版本标签不会自动获得新架构；解决旧 `latest` 的 ARM64 拉取失败，需要完成一次包含此配置的正式版本发布。

发布后检查实际要交付的标签：

```bash
docker buildx imagetools inspect ghcr.io/redcath/hollymusic:preview
# 正式发布后再检查 latest
docker buildx imagetools inspect ghcr.io/redcath/hollymusic:latest
```

预期至少包含 `linux/amd64`、`linux/arm64`。本地有 Docker 时，也可在对应架构主机验证尚未发布的源码：

```bash
docker build -t hollymusic:setup-test .
node scripts/test-docker-setup.mjs hollymusic:setup-test
```

Prisma 的 `native` 会随构建平台选择引擎，schema 同时显式包含 Debian AMD64 和 Linux ARM64 的 OpenSSL 3 引擎。修改 `binaryTargets` 仅影响生成产物，不涉及数据库表结构，无需新增数据库迁移。

- [贡献与 PR 流程](../CONTRIBUTING.md)
- [VS Code 调试指南](DEBUG-GUIDE.md)
- [音源配置热重载](CONFIG-HOT-RELOAD.md)
- [仓库展示与截图维护](REPOSITORY-PRESENTATION.md)
