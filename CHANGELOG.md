# 更新日志

本项目所有重要变更均会记录在此文件中。自 v0.18.0 起由发布流水线基于提交记录自动生成并维护，无需手工更新；每个版本的完整说明也可在 [GitHub Releases](https://github.com/redcatH/HollyMusic/releases) 查看。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [v0.17.0] - 2026-08-06

首个提供 Docker 镜像与版本 tag 的发布，涵盖此前全部功能：

- **多源聚合播放**：QQ / 网易 / 酷我 / 酷狗 / 咪咕统一搜索，音质回退（`flac24bit → flac → 320k → 128k`），音源热重载
- **服务端磁盘缓存 + 边下边播**：音频服务端落盘，HTTP Range 支持，浏览器原生 seek / 暂停 / 恢复；多用户共享缓存，LRU 自动清理
- **用户系统**：多用户数据隔离、签名 Cookie（HMAC-SHA256）鉴权、admin 用户管理、登录安全加固
- **AI 能力**：AI 协助建歌单（用户侧）、AI 推荐任务（admin）
- **Subsonic 协议兼容**、**一键分享**、**PWA**、**Docker 一键部署**

> v0.17.0 之前的完整提交历史可执行 `git log v0.17.0` 查看。

## 未发布

### ✨ 新增功能

- **ci**：tag 发布自动创建 GitHub Release 并自动维护 CHANGELOG


### 🐛 问题修复

- **ci**：release job 显式 always()，修复补发时被隐式 success() 跳过


## v0.21.1（2026-08-21）

**完整对比**：[v0.21.0 → v0.21.1](https://github.com/redcatH/HollyMusic/compare/v0.21.0...v0.21.1)

### 🐛 问题修复

- **layout**：safe-area-bottom 改为安全区叠加基础间距，修复内容贴死屏幕底边


### 🎨 界面与样式

- **home**：手机端首页收紧留白与头部间距，卡片隐藏音质角标


## v0.21.0（2026-08-21）

**完整对比**：[v0.20.2 → v0.21.0](https://github.com/redcatH/HollyMusic/compare/v0.20.2...v0.21.0)

### ✨ 新增功能

- **player**：重写"下一首播放"为插播队列模型，修复静默失效并补全首页/手机端入口
- **mobile**：长按呼出歌曲菜单 + 触屏扩大"⋯"/收藏命中区，对齐商业 App 交互标准


### 🐛 问题修复

- **menu**："加入歌单"弹窗独立于菜单挂载，修复 playlistUid 残留导致开菜单即弹弹窗


## v0.20.2（2026-08-20）

**完整对比**：[v0.20.1 → v0.20.2](https://github.com/redcatH/HollyMusic/compare/v0.20.1...v0.20.2)

### 🐛 问题修复

- **docker**：移除 docker-compose.yml 私有外部网络依赖，源码构建方式开箱即用
- **lyrics**：解码音源返回的 HTML 实体编码歌词（&#x660E; 等），特征检测保障未编码歌词零影响


### 📝 文档

- **docker**：新增 docker-compose.example.yml 镜像直拉部署示例，README 改为下载示例文件


## v0.20.1（2026-08-20）

**完整对比**：[v0.20.0 → v0.20.1](https://github.com/redcatH/HollyMusic/compare/v0.20.0...v0.20.1)

### 🐛 问题修复

- **cache**：试听片段不落库，解析真实时长与 interval 对比，存量缓存命中自愈


## v0.20.0（2026-08-19）

**完整对比**：[v0.20.0-beta.1 → v0.20.0](https://github.com/redcatH/HollyMusic/compare/v0.20.0-beta.1...v0.20.0)

### 🐛 问题修复

- **a11y**：队列抽屉与歌词面板支持 Esc 关闭并补 dialog 语义
- **admin**：/admin/users|sources|recommend 历史路由重定向到对应 tab，不再固定显示用户管理
- **mobile**：队列移除/歌曲行收藏等悬停按钮在触屏设备可见，桌面保留 hover 渐显
- **lyrics**：tx/kw/mg 纯文本歌词回退展示，不再误显示「暂无歌词」
- **ui**：修改密码两次不一致时错误提示只显示一次，去掉与内联提示重复的横幅
- **download**：缓存 miss 时完整交付不截断，透传 Range 支持断点续传


## v0.20.0-beta.1（2026-08-19）

**完整对比**：[v0.19.2 → v0.20.0-beta.1](https://github.com/redcatH/HollyMusic/compare/v0.19.2...v0.20.0-beta.1)

### ✨ 新增功能

- **download**：下载音质跟随播放音质偏好


### 🛡️ 安全修复

- **security**：AI 密钥外发防护——服务端 env key 与 env baseUrl 强制绑定


## v0.19.2（2026-08-18）

**完整对比**：[v0.19.1 → v0.19.2](https://github.com/redcatH/HollyMusic/compare/v0.19.1...v0.19.2)

### 🛡️ 安全修复

- **security**：Subsonic /rest/* 默认强制认证，杜绝冒名越权
- **security**：登录限速改双维度 + 修复 XFF 伪造绕过
- **security**：改密码后旧会话全部失效（sessionVersion 会话纪元）


### 🐛 问题修复

- **audio**：音频链路补齐超时，防音源脚本挂起永久卡死
- **player**：前端 AbortError 误判修复，点暂停不再跳歌/停播
- **ci**：apt 换源改为可选 build-arg，修复 CI 访问清华源 403


### 📝 文档

- **readme**：新增 QQ 交流群入口与 docker run 单命令部署方式
- **readme**：重写项目初衷，突出简单/洛雪音源/轻存储/分享
- **readme**：交流群改为顶部徽章+文末二维码布局
- **env**：补充 REQUIRE_AUTH / TRUST_PROXY 环境变量说明与变更记录


## v0.19.1（2026-08-13）

**完整对比**：[v0.19.0 → v0.19.1](https://github.com/redcatH/HollyMusic/compare/v0.19.0...v0.19.1)

### 🐛 问题修复

- **build**：AUTH_SECRET 改为惰性求值，修复 CI 构建失败
- **config**：music-sources.json 缺失时自动初始化，修复首次部署上传音源报错


## v0.19.0（2026-08-13）

**完整对比**：[v0.18.0 → v0.19.0](https://github.com/redcatH/HollyMusic/compare/v0.18.0...v0.19.0)

### 🛡️ 安全修复

- **security**：修复三处致命安全漏洞


### 🐛 问题修复

- **auth**：修复 Docker 部署 HTTP 直连下登录后未登录


### 📝 文档

- **deploy**：README 补充预构建镜像快速部署说明
- **readme**：重写开头突出洛雪音源兼容卖点
- **readme**：补充项目初衷——浏览器即用/换机免装/iOS 通吃
- **readme**：新增部署条件速查表


### 🔧 工程与依赖

- **docs**：清理过期文档与死代码
- **deps**：升级低风险依赖


## v0.18.0（2026-08-11）

**完整对比**：[v0.17.0 → v0.18.0](https://github.com/redcatH/HollyMusic/compare/v0.17.0...v0.18.0)

### ✨ 新增功能

- **playlist**：多源搜索深度可配 + PC 弹窗排版优化
- **auth**：登录安全加固 + 删除公开缓存清理接口
- **auth**：优化改密便利性与交互体验


### 🐛 问题修复

- **auth**：修复重启反复要求改密 + 强制改密页增加退出登录
- **ci**：修复 Docker 构建因 custom-sources 缺失失败 + 升级 Actions 版本


### 📝 文档

- **readme**：更新 AI 建歌单多源搜索说明
- **readme**：补充手机端单曲分享落地页截图
- **readme**：重新排版界面预览区
- **readme**：重新排版界面预览区
- 项目开源规范化治理


### 🔧 工程与依赖

- 删除 pages router 死代码（含历史硬编码测试路径）


