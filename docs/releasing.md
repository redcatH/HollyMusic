# 维护者发布指南

发布顺序：功能 PR → 发布准备 PR → main CI 成功 → tag → 双架构镜像 → GitHub Release。
版本号和更新日志在打 tag 之前合入 main，发布任务不向受保护分支回写，也不需要绕过保护的 PAT。

## 准备版本

使用 Node 24、pnpm 10.22.0 和 [git-cliff 2.14.2](https://github.com/orhun/git-cliff/releases/tag/v2.14.2)。
可把 git-cliff 加入 PATH，或设置 `GIT_CLIFF_BIN` 为可执行文件的绝对路径。

```bash
git switch main
git pull --ff-only
git fetch origin --tags
git switch -c chore/release-v0.30.4
pnpm release:prepare 0.30.4
pnpm release:check
pnpm test:release
```

命令要求干净工作区和递增且未使用的 SemVer，修改根目录与 frontend 的版本号，生成
`docs/releases/v0.30.4.md`，并将正式版本说明添加到 CHANGELOG 顶部。现有历史段落不会重新生成。
预发布如 `0.30.4-preview.1` 只添加独立发布说明，不写入正式版 CHANGELOG；正式发布仍包含上一正式版之后的全部提交。
修改 package 的版本号不改变这两个私有包的 lockfile importer，因此无需为版本号重新解析依赖。

审阅草稿，补充用户可理解的变更、兼容性与升级步骤。正式版如需编辑说明，请同时修改独立文件和 CHANGELOG 对应段落，`release:check` 会校验二者一致。
提交为 `chore(release): prepare v0.30.4` 并创建 PR。准备提交从未来的自动生成说明中排除。
合并前若 main 又加入需要发布的功能，应重新准备和审阅说明，避免遗漏。

## 打 tag 与发布

发布准备 PR 通过 `check` 并 squash 合入 main 后，等待 **main 分支该提交**的 CI 成功。
取该合并提交 SHA（示例中的 `<merge-sha>`），不要误用 PR 分支上的提交：

```bash
git fetch origin main --tags
git tag -a v0.30.4 <merge-sha> -m "v0.30.4"
git push origin v0.30.4
```

工作流会校验 tag 格式、main 祖先关系、版本号、事先审阅的说明和目标提交的最新 main CI。
CI 尚在运行时最多等待 10 分钟；失败或超时会停止发布。
随后分别在原生 amd64/arm64 runner 构建并验证首次设置、迁移、会话和重启，两个平台都通过后才合并清单。
版本镜像不可覆盖；`latest` 和 `preview` 分别只前进到更高的正式版和预发布版本。
首次遇到没有版本注解的旧通道镜像时，会与已有 Release 的版本镜像清单核对，无法确认则停止覆盖通道。

发布使用全局串行队列，运行中任务不会被新 tag 取消。`queue: max` 使用 GitHub Actions 的
[并发排队语法](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)。
actionlint 1.7.12 尚未识别这个字段，本地检查可仅过滤该项：

```bash
actionlint -ignore 'unexpected key "queue" for "concurrency" section'
```

发布后检查版本镜像、通道镜像与 Release，并在实际部署上验证搜索、播放和数据保留：

```bash
docker buildx imagetools inspect ghcr.io/redcath/hollymusic:v0.30.4
docker buildx imagetools inspect ghcr.io/redcath/hollymusic:latest
```

## 失败恢复

- 版本镜像尚未发布：修复失败原因后重跑任务，或修复代码并准备新版本。不要移动旧 tag。
- 版本镜像已发布、Release 创建失败：在 main 上手动运行发布工作流，输入已有 tag；它先验证镜像含两个架构，再恢复说明，不重建镜像、不修改通道或 Latest。
- 通道更新失败：先核对已发布版本清单和当前通道，不要用旧流水线覆盖已有版本。手动恢复 Release 不会修复通道；确认故障后通过新的版本发布继续推进。
- v0.30.3 及以前的 tag 尚无独立说明，补发只允许从已补齐的 CHANGELOG 读取，仍要求 tag 存在且镜像具有两个架构。

本次维护将两个 package 版本纠正为已发布的 0.30.3，并补齐 21 个缺失正式版段落；这只是元数据修复，不代表重新发布或覆盖 v0.30.3 镜像。

## 依赖维护

Dependabot 同时检查根目录、frontend、GitHub Actions 和 Docker。React/React DOM/类型包、Next/ESLint 配置、Vite/Vitest 按关联关系成组更新。
锁定 pnpm 10.22.0，Node 主版本记录在 `.node-version`；更改时同步 Dockerfile 与两个 package 的 engines，并运行 `release:check`。
PR 的 `check` 聚合质量检查和两个架构的容器测试，任一失败、取消或跳过都不能合并。

2026-10-31：生产依赖与 frontend 完整审计无告警；根目录 ESLint 间接依赖 minimatch 仍有 2 项 moderate 告警。
当前公告只给出 11.0.1 的修复线，强制覆盖 ESLint 所依赖的旧主版本可能破坏 glob 行为，因此保留告警并等待兼容的上游工具链升级。
