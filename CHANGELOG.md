# 更新日志

重要变更先在发布准备 PR 中审阅并合并，再创建版本 tag。历史说明与迁移指导保留在此文件；完整发布记录见 [GitHub Releases](https://github.com/redcatH/HollyMusic/releases)，操作步骤见 [发布指南](docs/releasing.md)。

版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。v0.30.3 及以前缺失的正式版记录已按 GitHub Release 补齐；历史预发布说明保留在对应版本内。

## v0.30.3（2026-10-30）

**完整对比**：[v0.30.2 → v0.30.3](https://github.com/redcatH/HollyMusic/compare/v0.30.2...v0.30.3)

### 🐛 问题修复

- **search**：paginate platform results and load complete toplists (#129)（[@redcatH](https://github.com/redcatH/HollyMusic/pull/129)）

## v0.30.2（2026-10-28）

**完整对比**：[v0.30.1 → v0.30.2](https://github.com/redcatH/HollyMusic/compare/v0.30.1...v0.30.2)

### 🐛 问题修复

- **player**：preserve shuffle history and playback queue order

## v0.30.1（2026-10-28）

**完整对比**：[v0.30.0 → v0.30.1](https://github.com/redcatH/HollyMusic/compare/v0.30.0...v0.30.1)

### 🐛 问题修复

- **mobile**：improve player actions and add screen wake lock
- **favorites**：add search across saved songs


### ♻️ 重构优化

- **brand**：centralize generic logo and preserve holly drafts


### 🔧 工程与依赖

- remove unused root HTTP test file
- remove unused legacy code and assets

## v0.30.0（2026-10-21）

**完整对比**：[v0.29.5 → v0.30.0](https://github.com/redcatH/HollyMusic/compare/v0.29.5...v0.30.0)

### ✨ 新增功能

- **站点设置**：管理员可配置站点名称与简介，默认使用 Holly Music 和「把时间交给音乐」，支持预览与恢复默认值。
- **统一品牌展示**：导航、登录、浏览器标题、分享页与 PWA 清单同步使用站点设置；保留项目署名和「关于 Holly Music」。
- **离线体验**：保留最近成功的公开站点设置，PWA 清单优先联网并支持离线回退。

### ✅ 验证

- 通过 732 项后端测试、337 项前端测试、类型检查及前后端生产构建。
- 完成桌面、手机长名称布局、设置保存与重置、分享转义及真实 Service Worker 离线启动验证。

## v0.29.5（2026-10-20）

**完整对比**：[v0.29.4 → v0.29.5](https://github.com/redcatH/HollyMusic/compare/v0.29.4...v0.29.5)

### 🐛 问题修复

- 优化播放体验与更新安卓播放优化说明 (#124)（[@a-ke](https://github.com/redcatH/HollyMusic/pull/124)）

## v0.29.4（2026-10-20）

**完整对比**：[v0.29.3 → v0.29.4](https://github.com/redcatH/HollyMusic/compare/v0.29.3...v0.29.4)

### ✨ 新增功能

- **playlists**：add platform playlist favorites
- **subsonic**：expose platform playlist favorites（[@redcatH](https://github.com/redcatH/HollyMusic/pull/125)）


### 🐛 问题修复

- **ui**：use full width for mobile playlist details
- **ui**：compact mobile discovery header
- **subsonic**：resolve prefixed playlist covers


### 📝 文档

- **readme**：explain iOS EQ background playback compatibility

## v0.29.3（2026-10-20）

**完整对比**：[v0.29.2 → v0.29.3](https://github.com/redcatH/HollyMusic/compare/v0.29.2...v0.29.3)

### 🐛 问题修复

- **player**：restore native playback when disabling EQ on iOS

## v0.29.2（2026-10-20）

**完整对比**：[v0.29.1 → v0.29.2](https://github.com/redcatH/HollyMusic/compare/v0.29.1...v0.29.2)

### 🐛 问题修复

- **pwa**：修复快速下载时本地歌曲缓存被提前放弃 (#123)（[@redcatH](https://github.com/redcatH/HollyMusic/pull/123)）

## v0.29.1（2026-10-19）

**完整对比**：[v0.29.0 → v0.29.1](https://github.com/redcatH/HollyMusic/compare/v0.29.0...v0.29.1)

### ✨ 新增功能

- **player**：重设计声音设置页面并修复 EQ 开关 (#122)（[@redcatH](https://github.com/redcatH/HollyMusic/pull/122)）

## v0.29.0（2026-10-19）

**完整对比**：[v0.29.0-preview.2 → v0.29.0](https://github.com/redcatH/HollyMusic/compare/v0.29.0-preview.2...v0.29.0)

### ✨ 新增功能

- **discovery**：添加 QQ 推荐歌单选项 (#120)（[@redcatH](https://github.com/redcatH/HollyMusic/pull/120)）


### v0.29.0-preview.2（2026-10-19）

**完整对比**：[v0.29.0-preview.1 → v0.29.0-preview.2](https://github.com/redcatH/HollyMusic/compare/v0.29.0-preview.1...v0.29.0-preview.2)

#### ✨ 新增功能

- **player**：添加兼容 PWA 的十段均衡器 (#118)（[@a-ke](https://github.com/redcatH/HollyMusic/pull/118)）


#### 🐛 问题修复

- **sources**：sync LX search APIs and complete playlist pagination (#119)（[@redcatH](https://github.com/redcatH/HollyMusic/pull/119)）


### v0.29.0-preview.1（2026-10-19）

**完整对比**：[v0.28.0 → v0.29.0-preview.1](https://github.com/redcatH/HollyMusic/compare/v0.28.0...v0.29.0-preview.1)

#### ✨ 新增功能

- **pwa**：完善离线播放与应用安装功能 (#117)（[@a-ke](https://github.com/redcatH/HollyMusic/pull/117)）

## v0.28.0（2026-10-16）

**完整对比**：[v0.28.0-preview.4 → v0.28.0](https://github.com/redcatH/HollyMusic/compare/v0.28.0-preview.4...v0.28.0)

### 🐛 问题修复

- **docker**：发布经过验证的 AMD64 和 ARM64 镜像 (#116)（[@redcatH](https://github.com/redcatH/HollyMusic/pull/116)）


### v0.28.0-preview.4（2026-10-15）

**完整对比**：[v0.28.0-preview.3 → v0.28.0-preview.4](https://github.com/redcatH/HollyMusic/compare/v0.28.0-preview.3...v0.28.0-preview.4)

#### 🐛 问题修复

- **subsonic**：统一网页音质选择并修复原格式与码率映射 (#114)（[@redcatH](https://github.com/redcatH/HollyMusic/pull/114)）


### v0.28.0-preview.3（2026-10-15）

**完整对比**：[v0.28.0-preview.2 → v0.28.0-preview.3](https://github.com/redcatH/HollyMusic/compare/v0.28.0-preview.2...v0.28.0-preview.3)

#### ✨ 新增功能

- **player**：刷新后保留音量并恢复播放队列与进度 (#113)（[@redcatH](https://github.com/redcatH/HollyMusic/pull/113)）


### v0.28.0-preview.2（2026-10-15）

**完整对比**：[v0.28.0-preview.1 → v0.28.0-preview.2](https://github.com/redcatH/HollyMusic/compare/v0.28.0-preview.1...v0.28.0-preview.2)

#### 🐛 问题修复

- **ci**：修复 preview 镜像发布与累计更新说明 (#112)（[@redcatH](https://github.com/redcatH/HollyMusic/pull/112)）


### v0.28.0-preview.1（2026-10-15）

**完整对比**：[v0.27.3 → v0.28.0-preview.1](https://github.com/redcatH/HollyMusic/compare/v0.27.3...v0.28.0-preview.1)

#### ✨ 新增功能

- **auth**：支持网页首次初始化并兼容历史部署 (#110)（[@redcatH](https://github.com/redcatH/HollyMusic/pull/110)）

## v0.27.3（2026-10-09）

**完整对比**：[v0.27.2 → v0.27.3](https://github.com/redcatH/HollyMusic/compare/v0.27.2...v0.27.3)

### 🐛 问题修复

- **pwa**：修复 iOS 独立模式首次打开时的底部空白 (#108)（[@redcatH](https://github.com/redcatH/HollyMusic/pull/108)）

## v0.27.2（2026-10-09）

**完整对比**：[v0.27.1 → v0.27.2](https://github.com/redcatH/HollyMusic/compare/v0.27.1...v0.27.2)

### 🐛 问题修复

- **player**：修复歌词自动跟随导致底部留白 (#107)（[@redcatH](https://github.com/redcatH/HollyMusic/pull/107)）


### 📝 文档

- **readme**：精简项目介绍并更新脱敏界面截图 (#106)（[@redcatH](https://github.com/redcatH/HollyMusic/pull/106)）

## v0.27.1（2026-10-09）

**完整对比**：[v0.27.0 → v0.27.1](https://github.com/redcatH/HollyMusic/compare/v0.27.0...v0.27.1)

### 🐛 问题修复

- **ui**：修复桌面主面板滚动条超出圆角并稳定内容布局 (#105)（[@redcatH](https://github.com/redcatH/HollyMusic/pull/105)）

## v0.27.0（2026-10-08）

**完整对比**：[v0.26.6 → v0.27.0](https://github.com/redcatH/HollyMusic/compare/v0.26.6...v0.27.0)

### ✨ 新增功能

- **ui**：新增可切换主题并优化桌面、移动端与 PWA 体验 (#103)（[@redcatH](https://github.com/redcatH/HollyMusic/pull/103)）

## v0.26.6（2026-10-03）

**完整对比**：[v0.26.5 → v0.26.6](https://github.com/redcatH/HollyMusic/compare/v0.26.5...v0.26.6)

### 📝 文档

- **ui**：explain NetEase CSV export (#101)（[@redcatH](https://github.com/redcatH/HollyMusic/pull/101)）

## v0.26.5（2026-10-03）

**完整对比**：[v0.26.4 → v0.26.5](https://github.com/redcatH/HollyMusic/compare/v0.26.4...v0.26.5)

### ✨ 新增功能

- **playlist**：import QQ public playlists (#99)（[@redcatH](https://github.com/redcatH/HollyMusic/pull/99)）


### 📝 文档

- **readme**：clarify playlist import matrix (#100)（[@redcatH](https://github.com/redcatH/HollyMusic/pull/100)）

## v0.26.4（2026-10-03）

**完整对比**：[v0.26.3 → v0.26.4](https://github.com/redcatH/HollyMusic/compare/v0.26.3...v0.26.4)

### ✨ 新增功能

- **playlist**：import NetEase CSV playlists (#98)（[@redcatH](https://github.com/redcatH/HollyMusic/pull/98)）


### 🐛 问题修复

- **admin**：用户列表同时显示最近登录和最近活跃 (#97)（[@redcatH](https://github.com/redcatH/HollyMusic/pull/97)）

## v0.26.3（2026-09-30）

**完整对比**：[v0.26.2 → v0.26.3](https://github.com/redcatH/HollyMusic/compare/v0.26.2...v0.26.3)

### ✨ 新增功能

- 支持从歌单移除歌曲并优化多渠道搜索 (#95)（[@a-ke](https://github.com/redcatH/HollyMusic/pull/95)）

## v0.26.2（2026-09-28）

**完整对比**：[v0.26.1 → v0.26.2](https://github.com/redcatH/HollyMusic/compare/v0.26.1...v0.26.2)

### ✨ 新增功能

- **admin**：音源平台矩阵与批量管理，完善配置并发和失败恢复 (#81)（[@redcatH](https://github.com/redcatH/HollyMusic/pull/81)）


### 🐛 问题修复

- **auth**：redirect to login after logout (#94)（[@redcatH](https://github.com/redcatH/HollyMusic/pull/94)）

## v0.26.1（2026-09-21）

**完整对比**：[v0.26.0 → v0.26.1](https://github.com/redcatH/HollyMusic/compare/v0.26.0...v0.26.1)

### 🐛 问题修复

- **player/favorites**：修复单曲循环与时长归零，完善收藏竞态及歌单事务 (#88)（[@redcatH](https://github.com/redcatH/HollyMusic/pull/88)）

## v0.26.0（2026-09-06）

**完整对比**：[v0.25.0 → v0.26.0](https://github.com/redcatH/HollyMusic/compare/v0.25.0...v0.26.0)

### 🛡️ 安全修复

- **security**：音源脚本改在 vm 沙箱执行，移除主进程 eval (#79)（[@redcatH](https://github.com/redcatH/HollyMusic/pull/79)）
- **security**：音源执行迁入独立子进程，叠加进程隔离与权限加固 (#80)（[@redcatH](https://github.com/redcatH/HollyMusic/pull/80)）


### 🔧 工程与依赖

- **release**：同步 v0.22.1~v0.25.0 更新日志与版本号

## v0.25.0（2026-09-06）

**完整对比**：[v0.24.3 → v0.25.0](https://github.com/redcatH/HollyMusic/compare/v0.24.3...v0.25.0)

### ✨ 新增功能

- **playlist**：完善歌单管理、搜索与多音源详情 (#77)（[@a-ke](https://github.com/redcatH/HollyMusic/pull/77)）


### 🐛 问题修复

- **auth**：在服务启动时初始化用户 (#76)（[@a-ke](https://github.com/redcatH/HollyMusic/pull/76)）


### 🔧 工程与依赖

- 移除误提交的空 node.js 文件
- gitignore 忽略 Next.js dev 日志与 GUI 测试截图

## v0.24.3（2026-08-25）

**完整对比**：[v0.24.2 → v0.24.3](https://github.com/redcatH/HollyMusic/compare/v0.24.2...v0.24.3)

### ✨ 新增功能

- **player**：频谱无分析数据时降级为合成动画


### 🐛 问题修复

- **player**：修复 iOS PWA 退后台停播


### 🔧 工程与依赖

- **deps**：批量合并 dependabot 升级 #46-#53
- **deps**：bump react and @types/react
- **deps**：bump dayjs from 1.11.19 to 1.11.21
- **deps-dev**：bump eslint from 9.39.2 to 9.39.5
- **deps**：bump needle from 3.3.1 to 3.5.0
- **deps-dev**：bump eslint-config-next from 16.1.1 to 16.3.1
- **deps**：bump react-use from 17.6.0 to 17.6.1
- **deps**：bump next from 16.2.12 to 16.3.1
- **deps**：bump dexie from 4.2.1 to 4.4.4
- **deps**：升级 tailwindcss 4.3.3 + vitest 3.2.7

## v0.24.2（2026-08-24）

**完整对比**：[v0.24.1 → v0.24.2](https://github.com/redcatH/HollyMusic/compare/v0.24.1...v0.24.2)

### 🐛 问题修复

- **discover**：图片加载改混合模式——仅被拦的 gtimg 域走代理，其余直连

## v0.24.1（2026-08-24）

**完整对比**：[v0.24.0 → v0.24.1](https://github.com/redcatH/HollyMusic/compare/v0.24.0...v0.24.1)

### 🐛 问题修复

- **discover**：图片代理白名单补充 qpic.y.qq.com 域名族

## v0.24.0（2026-08-24）

**完整对比**：[v0.23.0 → v0.24.0](https://github.com/redcatH/HollyMusic/compare/v0.23.0...v0.24.0)

### ✨ 新增功能

- **search**：搜索页交互改进——显式搜索按钮与 chips 源切换


### 🐛 问题修复

- **discover**：远程封面改走后端图片代理，规避浏览器拦截
- **dev**：Windows 下 vite 轮询监听根目录共享代码，修复 HMR 偶发失效
- **search**：修复加载/空态混淆与网络失败静默为空结果
- **ui**：小屏隐藏页内大标题，与 MobileHeader 标题去重

## v0.23.0（2026-08-23）

**完整对比**：[v0.22.1 → v0.23.0](https://github.com/redcatH/HollyMusic/compare/v0.22.1...v0.23.0)

### ✨ 新增功能

- **discover**：榜单封面——五源列表获取、60分钟缓存防击穿、详情首曲兜底

## v0.22.1（2026-08-23）

**完整对比**：[v0.22.0 → v0.22.1](https://github.com/redcatH/HollyMusic/compare/v0.22.0...v0.22.1)

### 🛡️ 安全修复

- **security**：镜像不再内置初始密码文件，构建日志不再打印密码 (#63)（[@redcatH](https://github.com/redcatH/HollyMusic/pull/63)）


> 🔐 **安全修复，建议所有用户升级**：自首个 Docker 版本起，构建过程会把初始管理员密码文件（`config/users.json`）打进镜像，且该密码打印在公开的构建日志中。未挂载 `./config` 卷直接 `docker run` 的实例受影响，应升级并立即修改 admin 密码；按 README 推荐 compose 部署并挂载卷的实例不受影响。详见 [#63](https://github.com/redcatH/HollyMusic/pull/63)。

## v0.22.0（2026-08-23）

**完整对比**：[v0.21.4 → v0.22.0](https://github.com/redcatH/HollyMusic/compare/v0.21.4...v0.22.0)

### ✨ 新增功能

- 完善发现页、在线音源订阅、歌词缓存与播放器体验 (#60)（[@a-ke](https://github.com/redcatH/HollyMusic/pull/60)） ⚠️ **破坏性变更**：匿名调用 /api/music-url、/api/lyrics、/api/track、/api/random 将返回 401，外部直连需先登录获取会话。


### 🔧 工程与依赖

- **release**：同步 v0.21.4 更新日志与版本号
- 新增 PR 质量门禁与贡献指南对齐开源惯例 (#61)（[@redcatH](https://github.com/redcatH/HollyMusic/pull/61)）

## v0.21.4（2026-08-22）

**完整对比**：[v0.21.3 → v0.21.4](https://github.com/redcatH/HollyMusic/compare/v0.21.3...v0.21.4)

### 🐛 问题修复

- **subsonic**：search3 空 query 与 PC 发现音乐同源（白名单随机），恢复 songCount (#58)（[@redcatH](https://github.com/redcatH/HollyMusic/pull/58)）


### 🔧 工程与依赖

- **release**：同步 v0.21.3 更新日志与版本号

## v0.21.3（2026-08-22）

**完整对比**：[v0.21.2 → v0.21.3](https://github.com/redcatH/HollyMusic/compare/v0.21.2...v0.21.3)

### 🐛 问题修复

- **subsonic**：歌曲元数据真实化——bitRate/size/suffix 按默认播放音质推断 (#56)（[@redcatH](https://github.com/redcatH/HollyMusic/pull/56)）


### ⚡ 性能优化

- **cover**：压缩默认 404 封面，2048px/3.6MB → 512px/107KB (#57)（[@redcatH](https://github.com/redcatH/HollyMusic/pull/57)）


### 🔧 工程与依赖

- **release**：同步 v0.21.2 更新日志与版本号

## v0.21.2（2026-08-22）

**完整对比**：[v0.21.1 → v0.21.2](https://github.com/redcatH/HollyMusic/compare/v0.21.1...v0.21.2)

### ✨ 新增功能

- **ci**：tag 发布自动创建 GitHub Release 并自动维护 CHANGELOG
- **subsonic**：统一响应构造层，支持 XML/JSON/JSONP 输出 (#55)（[@redcatH](https://github.com/redcatH/HollyMusic/pull/55)）


### 🐛 问题修复

- **ci**：release job 显式 always()，修复补发时被隐式 success() 跳过
- **ci**：release notes 改在 main 上按 tag 区间生成，修复老 tag 缺 cliff.toml 回退默认模板


### 🔧 工程与依赖

- **release**：同步 v0.20.0 更新日志与版本号
- **release**：同步 v0.20.0 更新日志与版本号
- **release**：同步 v0.20.1 更新日志与版本号
- **release**：同步 v0.21.1 更新日志与版本号

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

## [v0.17.0] - 2026-08-06

首个提供 Docker 镜像与版本 tag 的发布，涵盖此前全部功能：

- **多源聚合播放**：QQ / 网易 / 酷我 / 酷狗 / 咪咕统一搜索，音质回退（`flac24bit → flac → 320k → 128k`），音源热重载
- **服务端磁盘缓存 + 边下边播**：音频服务端落盘，HTTP Range 支持，浏览器原生 seek / 暂停 / 恢复；多用户共享缓存，LRU 自动清理
- **用户系统**：多用户数据隔离、签名 Cookie（HMAC-SHA256）鉴权、admin 用户管理、登录安全加固
- **AI 能力**：AI 协助建歌单（用户侧）、AI 推荐任务（admin）
- **Subsonic 协议兼容**、**一键分享**、**PWA**、**Docker 一键部署**

> v0.17.0 之前的完整提交历史可执行 `git log v0.17.0` 查看。
