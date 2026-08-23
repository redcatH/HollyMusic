# 贡献指南

感谢你对 Holly Music 的兴趣！欢迎提交 Issue、Pull Request 或改进音源脚本。

> 📢 **第一次参与开源？** 从带 [`good first issue`](https://github.com/redcatH/HollyMusic/labels/good%20first%20issue) 标签的 Issue 入手，这些是适合新人的任务；使用问题和想法讨论请到 [Discussions](https://github.com/redcatH/HollyMusic/discussions)。

## 🐛 提交 Issue

- Bug 报告请使用 Bug Report 模板，附上复现步骤、预期/实际行为、环境信息（部署方式 / 浏览器 / 版本）
- 功能建议请使用 Feature Request 模板，说明使用场景与期望效果
- 提交前请先搜索是否已有相同 Issue，避免重复

## 🔧 开发准备

### 环境要求

- Node.js 20+（与 CI、Docker 镜像一致）
- pnpm 10（版本由 `package.json` 的 `packageManager` 字段锁定，`corepack enable` 后自动匹配）

### 本地启动

```bash
pnpm install
cd frontend && pnpm install && cd ..

# 配置环境变量（复制 .env.example）
cp .env.example .env

# 初始化数据库
npx prisma migrate dev --name init

# 同时启动后端 API（3000）与前端（5173）
pnpm dev:all
```

## 📝 代码规范

- **提交前运行 linter**：`pnpm lint`
- **类型检查**：`pnpm typecheck`
- **测试**：`pnpm test`
- TypeScript 严格模式，新增代码需通过类型检查
- 遵循现有代码风格（缩进、命名、注释密度）

PR 提交后 CI 会自动运行 **lint / 类型检查 / 测试 / 构建**（根项目与 `frontend/` 两套），全部通过才能合并。建议本地先跑一遍以上命令，节省往返时间。

## 🔄 提交与 PR 流程

### 分支策略

- 基于 `main` 分支创建 feature 分支：`feat/<简短描述>`、`fix/<简短描述>`
- 不要直接向 `main` 提交

### Commit Message

遵循 [约定式提交](https://www.conventionalcommits.org/zh-hans/)：

```
<type>(<scope>): <subject>

[可选 body]
[可选 footer]
```

常用 type：

| type | 说明 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `docs` | 文档变更 |
| `style` | 代码格式（不影响功能） |
| `refactor` | 重构（非新功能、非修 Bug） |
| `perf` | 性能优化 |
| `test` | 测试相关 |
| `chore` | 构建 / 工具 / 依赖变更 |

示例：`feat(player): 支持锁屏拖动进度`、`fix(auth): 修复重启反复要求改密`

### Pull Request

1. PR 请使用 Pull Request 模板填写
2. 一个 PR 只做一件事，保持变更聚焦
3. 描述清楚「改了什么」「为什么改」「如何测试」
4. 确保本地 `pnpm lint`、`pnpm typecheck`、`pnpm test` 通过（CI 也会自动检查）
5. 如涉及数据库 schema 变更，请创建新的 Prisma migration

### 合并与署名

- PR 以 **Squash and merge** 方式合入 `main`：一个 PR 对应 `main` 上一个提交，保持线性历史
- 合并提交的 **author 自动归属 PR 发起者**；其他参与者（包括一起改过代码的维护者）会以 `Co-authored-by` 尾注保留署名，贡献计入 GitHub 贡献图
- 更新日志由提交标题自动生成（见下方「发布」），请把 PR 标题当作更新日志条目来写：说清楚「改了什么、对用户意味着什么」

## ⚠️ 注意事项

- **不要随意修改** `lx-env-simulator/` 与 `lx-music-desktop-master/` 的核心逻辑，这两个是兼容层
- 音源脚本（`custom-sources/`）需遵循 `lx-env-simulator` 规范，实现 `musicSearch` / `musicInfo` / `lyric` / `pic` / `musicUrl` 接口
- 涉及鉴权、用户数据的改动请额外说明安全考量
- 新增 API 接口请遵循统一响应格式 `{ success, data?, error? }`

## 📦 发布

版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)：

- `MAJOR`：不兼容的 API 变更
- `MINOR`：向后兼容的新功能
- `PATCH`：向后兼容的 Bug 修复

更新日志（[CHANGELOG.md](CHANGELOG.md) 与 GitHub Release）由 [git-cliff](https://git-cliff.org) 基于合入 `main` 的提交标题自动生成并分组——这也是要求遵循约定式提交的直接原因。发布由维护者打 tag 触发，贡献者无需关心。

---

再次感谢你的贡献！如有疑问，欢迎提 Issue 讨论。
