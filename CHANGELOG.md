# 更新日志

本项目所有重要变更均会记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 安全修复
- **Subsonic /rest/* 默认强制认证**：所有接口（除 `ping`/`getScanStatus`/`getOpenSubsonicExtensions` 等豁免方法）要求 Subsonic token（`u+t+s`）认证，杜绝"传 `u=admin` 冒名读取他人收藏/私有歌单"的越权；`getPlaylists`/`getUser` 不再接受 query 参数指定他人身份。可通过 `REQUIRE_AUTH=false` 显式关闭（不推荐公网部署）
- **登录限速改双维度**：新增 `user:<用户名>` 维度，爆破必然针对特定用户名，不受伪造 `X-Forwarded-For` 绕过；新增 `TRUST_PROXY` 环境变量（默认 false），直连部署不再信任客户端可伪造的转发头，反代部署取 XFF 最后一段
- **音频链路补齐超时**：上游 URL 解析（洛雪脚本挂起）20s 超时、下载 stall 30s 超时（覆盖 header+body，慢速不误杀）、`waitForReadiness` 60s 兜底、透传模式 header 30s 超时；`getMusicUrl` 单次尝试 15s、全音源总预算 45s——音源脚本挂起不再导致请求永久卡死
- **前端 AbortError 误判修复**：缓冲中点暂停/快速切歌触发的 `play()` AbortError 不再被当作播放失败上报，修复"点暂停却跳歌/停播"；快速连切歌曲不再产生播放状态闪变

### 变更
- 项目开源化治理：新增 `LICENSE`（MIT）、`CONTRIBUTING.md`、`CODE_OF_CONDUCT.md`、PR / Issue 模板、`CHANGELOG.md`
- 精简 README 的 API 文档，区分对外接口与内部接口
- 删除过时的 `README_zh.md` / `README_en.md`
- 补全 `package.json` 元信息（name / description / license / repository / author / keywords）

## [0.1.0] - 2026-08

### ✨ 新增
- **多源聚合播放**：QQ / 网易 / 酷我 / 酷狗 / 咪咕等音源统一搜索，质量回退（`flac24bit → flac → 320k → 128k`）
- **服务端磁盘缓存 + 边下边播**：音频服务端落盘，HTTP Range 支持，浏览器原生 seek / 暂停 / 恢复；多用户共享缓存，LRU 自动清理
- **失败自动跳歌**：拉取失败 / 解码失败自动跳下一首，连续失败保护防死循环
- **音源热重载**：`config/music-sources.json` MD5 变更自动检测，无需重启
- **一键分享**：单曲 / 歌单 / 右键菜单分享，移动端 Web Share API，桌面端降级复制链接；分享落地页页内直接播放
- **PWA**：可安装到桌面、Service Worker 离线壳、Media Session 锁屏控制、刘海屏安全区适配
- **用户系统**：多用户数据隔离、签名 Cookie（HMAC-SHA256）鉴权、admin 用户管理
- **AI 推荐任务**（admin）：批量按歌手/歌曲跑 AI 筛选写入推荐白名单，多任务排队串行，支持重跑 / 取消 / 删除 / 回滚
- **AI 协助建歌单**（用户侧）：描述需求 → AI 生成候选 → 多源聚合搜索 → AI 过滤多版本 → 用户确认 → 创建歌单
- **Subsonic 协议兼容**：通过 `/rest/[method]` 作为 Subsonic 服务端被外部客户端访问
- **Docker 一键部署**：三阶段构建（前端 SPA + Next.js API + nginx 运行时），含 Prisma 自动迁移
- **登录安全加固**：IP 失败限速、强制改密、登录锁定管理

### 🐛 修复
- 修复重启后反复要求改密的问题
- 修复 AI 建歌单候选量失控与重复歌曲
- 修复管理端编辑音源后实例未立即重建的问题
- 修复分享落地页在微信爬虫下 og:title 丢失的问题

---

> 历史变更以 Git 提交记录为准，可用 `git log` 查看。
