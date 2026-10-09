# API 与 Subsonic

[返回项目首页](../README.md)

后端为 Next.js App Router，所有接口前缀 `/api`（Subsonic 协议走 `/rest`）。

- **统一响应格式**：`{ success: boolean, data?: T, error?: { code, message } }`
- **鉴权**：签名 Cookie（`holly_user` + `holly_sig`）。除分享落地页链路（`share` / `audio` / `cover`）与 `auth`、`health` 外，其余 `/api/*` 均需登录；`/rest/*` 为 Subsonic token 独立认证

## 对外接口

部署对接、外部客户端、反代探活会直接调用的接口：

| 路径 | 方法 | 说明 |
|------|------|------|
| `/rest/[method]` | GET/POST | Subsonic 协议入口，外部客户端（DSub / Ultrasonic 等）接入点（token 认证） |
| `/api/share` | GET | 分享落地页（服务端渲染 HTML，`?uid=` 单曲试听，含 og 卡片；匿名可访问） |
| `/api/track` | GET | 曲目元数据反查（`?uid=`，分享链接自动播放用；需登录） |
| `/api/audio` | GET/HEAD | 音频流（磁盘缓存 + Range；分享试听链路，保持匿名可访问） |
| `/api/cover/[id]` | GET | 封面代理（分享落地页封面来源，匿名可访问） |
| `/api/download` | GET | 下载代理（需登录） |
| `/api/health` | GET | 健康检查（Docker / 反代探活） |

## 内部接口

前端 SPA 自用，路径即语义，参数与返回值以 `app/api/` 下各 `route.ts` 源码为准，统一遵循上述响应格式：

- **鉴权** — `app/api/auth/*`：登录 / 登出 / 会话 / 改密 / 心跳
- **搜索与播放** — `search` / `music-url` / `lyrics` / `random` / `search-sources`（均需登录）
- **发现内容** — `discover/toplists`、`discover/toplists/[id]`、`discover/playlists`、`discover/playlists/[id]`；通过 `source` 参数选择内容来源
- **用户数据** — `favorites` / `history` / `playlists/*`（需登录，按用户隔离）
- **AI 功能** — `playlist-assist/*`（用户侧 AI 建歌单）、`admin/recommend*`（admin 推荐任务）
- **管理后台** — `app/api/admin/*`：用户 / 音源（含 `sources/subscriptions` 在线订阅导入）/ 缓存 / 登录锁定 / 推荐任务（仅 admin）

## Subsonic 常用兼容项

除 `ping`、`stream`、`getSong`、`getCoverArt`、歌词等基础接口外，已验证常用客户端会调用的以下能力：

- `search3`：普通搜索；空查询配合 `order=playDate` 时返回当前用户的最近播放
- `getRandomSongs`：从数据库中已入库、当前可用音源的曲目随机抽取
- `getStarred` / `getStarred2`、`star` / `unstar`：收藏读取与写入
- `getPlaylists`、`getPlaylist`、`createPlaylist`、`updatePlaylist`、`deletePlaylist`：歌单及歌单曲目管理
- `getAlbumList2`、`getAlbum`、`getLyricsBySongId`、`getOpenSubsonicExtensions`：专辑、结构化歌词与 OpenSubsonic 客户端兼容

### 在 Subsonic 客户端指定搜索源

在 Subsonic 客户端的搜索框中，为关键词添加搜索源前缀即可仅搜索对应来源；前缀会自动从实际搜索词中移除。未使用前缀时，仍按当前配置执行原有的多源聚合搜索。

支持的搜索源前缀为 `wy:`、`kg:`、`tx:`、`kw:`、`mg:`。例如，输入 `wy:风说` 时只会在 `wy` 搜索源中检索“风说”。

接口支持 XML 与 `f=json` JSON 响应。写操作要求有效的 Subsonic token 认证；具体认证开关见 `REQUIRE_AUTH` 配置与 `app/rest/[method]/route.ts`。
