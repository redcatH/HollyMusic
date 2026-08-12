# GitHub Copilot 使用说明（为本项目定制）

下面的说明用于引导 GitHub Copilot / Copilot Chat 在本仓库中给出更准确、有用的代码建议。内容以中文为主，针对本仓库的结构、约定和常见任务给出明确上下文与提示示例。

---

## 项目概览

- 本项目基于 Next.js（app 目录）与 TypeScript，前端使用 React 19、TailwindCSS；核心目录：`app/`、`components/`、`lib/`、`hooks/`、`public/`、`custom-sources/`、`lx-env-simulator/` 等。
- 主要关注点：音乐源聚合、播放控制、下载与代理请求，部分模拟器与历史兼容代码位于 `lx-env-simulator/` 
- 功能参考关注点： 主要参考协议以及用来实现 lx-env-simulator `lx-music-desktop-master/`。
- 技术栈：Next.js 16、React 19、TypeScript 5、Prisma（SQLite）、Tailwind CSS v4、zustand。

## 目标（对 Copilot 的期望）

- 生成与修改代码时遵循现有代码风格（函数式 React、hooks、TypeScript 类型、Tailwind 原子类）。
- 优先重用 `lib/` 下的工具函数与 `hooks/` 中的 hooks（例如 `useAudioPlayer.ts`, `useSearch.ts`）。
- 对涉及网络请求或音源解析的改动，保持对 `lx-env-simulator/` 与 `custom-sources/` 的兼容性。

## 编码约定（简要）

- 语言：TypeScript（`.ts`, `.tsx`）；尽量为导出函数与组件添加类型注解。
- 组件：函数式组件 + React hooks；样式尽量使用 Tailwind CSS 原子类。
- 路径别名：使用 `@/*`（根目录相对）。
- 日志：使用 `import { logger } from '@/lib/logger'`，不要用 `console.log`。
- 缓存：使用 `import { searchCache, urlCache } from '@/lib/cache-manager'` 导出的单例。
- 命名：组件 PascalCase、函数 camelCase、常量 UPPER_SNAKE_CASE。
- 导入顺序：第三方包 -> `lib/`、`hooks/` -> 同目录相对导入。
- Lint：使用仓库的 ESLint 配置（`eslint . --ext .js,.ts,.tsx`）。
- 不要修改或删除 `lx-env-simulator/` 内测试/兼容脚本，除非确认需要更新模拟逻辑。
- 对话过程必须使用中文

## 重要文件/目录说明（便于 Copilot 提供上下文）

- `app/`：Next.js 的页面与 API 路由（使用 app-router）；新接口放在 `app/api/` 下对应子目录。
- `components/`：可复用 UI 组件，分子目录按功能组织（`layout/`、`player/`、`search/` 等）。
- `lib/`：业务核心工具（请求封装、音乐源管理、下载、缓存、日志等）。优先调用已有方法。
- `hooks/`：常用 hooks（`useAudioPlayer.ts`, `useDownload.ts`, `useSearch.ts` 等）。
- `custom-sources/`：第三方或自定义音源脚本（通常为 JS 脚本），新增音源需按现有格式实现并在 `music-sources.json` 中注册。
- `lx-env-simulator/`：兼容层与测试脚本，慎改。

### 常见任务速查表

| 任务 | 位置 | 说明 |
|------|------|------|
| 音源管理 | `lib/music-source-manager.ts` | 多源优先级、音质回退 |
| 数据库操作 | `lib/db.ts` | Prisma 封装，upsert + checksum |
| 缓存 | `lib/cache-manager.ts` | 内存缓存，带 TTL |
| API 路由 | `app/api/` | Next.js route handlers |
| 自定义音源 | `custom-sources/` | 在 `config/music-sources.json` 注册 |
| 下载工具 | `lib/server/download-utils.ts` | URL 校验、限流 |

## 音源与数据相关约定

- **音质回退顺序**：`flac24bit` → `flac` → `320k` → `128k`。
- **音源热重载**：`MusicSourceManager` 每次请求会检查 `config/music-sources.json` 的 MD5，变更自动重载。
- **音源必需接口**：`musicSearch`、`musicInfo`、`lyric`、`pic`、`musicUrl`。
- **music-core**：CommonJS 模块（`require/module.exports`），由 `MusicSourceManager` 通过 `require()` 加载，不要转为 ES module。
- **数据库**：Prisma + SQLite，路径通过 `DATABASE_URL` 环境变量配置；迁移用 `prisma migrate dev` 生成。

## 反模式（本项目禁止）

1. ❌ 不要在生产代码用 `console.log` → 用 `logger`。
2. ❌ 不要忽略 TypeScript 类型错误。
3. ❌ 不要提交 `.env` 文件。
4. ❌ 不要在组件中直接调用服务端 API → 走 API 路由。
5. ❌ 不要直接操作 DOM → 用 React refs。
6. ❌ 不要新建缓存管理器实例 → 用导出的单例。
7. ❌ 不要绕过 `db.ts` upsert 的 checksum 校验。

## 常见任务：示例提示（prompt examples，中文）

- 新增页面组件（app + TSX）
  - 提示示例："在 `app/` 下创建一个名为 `artist/[id]/page.tsx` 的页面，使用 React + TypeScript，显示歌手名、头像和歌单列表，使用现有 `components/layout/Header.tsx` 作为页面头部，样式使用 Tailwind。"

- 新增可复用组件
  - 提示示例："在 `components/player/` 中创建 `MiniPlayer.tsx`，接收当前播放信息与控制回调，使用 `useAudioPlayer` hook，遵循项目中现有 Player 风格。"

- 调用后端 API（Next.js API Route）
  - 提示示例："在 `app/api/music-url/route.ts` 中添加一个 POST 路由，接收 `id` 参数，使用 `lib/music-source-manager.ts` 获取播放地址并返回 JSON，添加必要的类型定义和错误处理。"

- 新增/更新音乐源脚本
  - 提示示例："在 `custom-sources/` 下新增 `my-source.js`，实现搜索与获取播放 URL 的方法，匹配现有脚本风格（查看 `聚合API接口.js` 作为参考）。"

- 优化性能或修复漏洞
  - 提示示例："在 `lib/cache-manager.ts` 中减少重复请求，请优先复用缓存并在失效时刷新，保留现有行为兼容性。"

## 提示使用建议（如何给 Copilot 足够上下文）

- 在 prompt 中包含：目标文件路径、想要的输入/输出类型、要复用的现有模块或 hook、是否需要单元测试。
- 提供已有函数签名或引用现有工具（如 `music-source-manager.ts`），避免 Copilot 随意创建新全局工具。
- 对于对外部 API 的请求，要求添加超时与错误捕获逻辑，并遵循现有 `logger.ts` 的日志格式。

## 运行与开发（示例命令）

在本仓库常用 package 脚本：

```powershell
pnpm install
pnpm dev
pnpm build
pnpm start
pnpm lint
```

备注：仓库包含 `pnpm-lock.yaml`，建议使用 `pnpm`。

## 不要建议或做的变更（安全与兼容）

- 不要在没有说明的情况下修改 `lx-env-simulator/` 或 `lx-music-desktop-master/` 的核心逻辑。
- 不要删除或重命名现有音乐源脚本，除非提供迁移步骤并更新 `music-sources.json`。
- 避免引入大型新依赖（在建议依赖前先检查 `package.json` 并征求同意）。

## PR / 提交建议

- 小而明确的 PR：每个 PR 专注一项功能或修复，包含变更说明与复现步骤。
- commit message 示例：`feat(player): add MiniPlayer component with hooks` 或 `fix(api): handle timeout for music-url route`。

## 示例对话模板（可直接粘给 Copilot）

"仓库是一个基于 Next.js + TypeScript 的音乐播放聚合前端，文件结构见 `app/`、`components/`、`lib/`、`hooks/`。请在 `components/player/` 下创建 `MiniPlayer.tsx`，使用 `useAudioPlayer` hook，类型安全，Tailwind 样式，包含必要的单元测试样例。不要修改 `lx-env-simulator/`。"
