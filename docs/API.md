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

### 平台收藏歌单

网页收藏的 QQ、网易云、酷我、酷狗、咪咕歌单会出现在同一账号的 `getPlaylists` 中，名称带平台标识。列表使用收藏时的快照；打开 `getPlaylist` 时复用发现音乐的详情缓存（10 分钟），读取原平台内容，并沿用现有歌曲播放、封面、歌词和喜爱状态。

- 收藏使用 `fp-{收藏记录ID}`，本地歌单仍用数字 ID；封面为 `pl-fp-{收藏记录ID}`，也兼容客户端追加的 `al-` 前缀。
- 收藏内容只读：`createPlaylist` 指定收藏 ID 或 `updatePlaylist` 修改收藏时返回错误 50。需要编辑时，可将歌曲添加到本地歌单。
- `deletePlaylist` 对收藏 ID 仅取消当前账号在 Holly Music 中的收藏，不会删除平台原歌单或歌曲；网页下次加载收藏列表时同步体现。
- 原平台暂时不可用时，详情返回错误，收藏仍保留。收藏列表和封面都要求有效 token，即使服务器开启匿名读取也不能冒用用户名访问收藏。

### 播放音质与原格式

`stream` 与网页共用取流和磁盘缓存。Subsonic 根据客户端参数选择立体声版本，优先尝试选定档位的可用音源，再向下回退。如果歌曲声明的立体声版本都高于偏好，则从其中最低档开始。

| 请求参数 | 起始音质偏好 |
|---|---|
| `format=raw` | 默认 Hi-Res，优先于同时传入的码率参数 |
| 码率缺省、空值或 `maxBitRate=0` | 默认 Hi-Res，`format=mp3` 时偏好 320k |
| `maxBitRate>=320` | 320k |
| `0<maxBitRate<320` | 128k |

无损不可用时仍允许降级。服务选择现有音质，不进行实时转码；因此 `maxBitRate` 在本项目是可播放优先的偏好，向上兜底或请求低于 128kbps 时可能超过指定值。正数码率不用于推测 FLAC 档位。非 raw 请求的码率必须是非负安全整数，非法值返回 Subsonic 参数错误。

设置 `SUBSONIC_STEREO_MAX_QUALITY=master` 后，原格式或不限码率的立体声请求可选择歌曲声明的母带。搜索、详情、专辑、歌单及收藏按该上限展示歌曲声明的立体声版本，未知无损码率省略。实际流的 MIME 和范围响应以命中的文件为准。升级后可刷新客户端歌曲信息。

### 在 Subsonic 客户端指定搜索源

在 Subsonic 客户端的搜索框中，为关键词添加搜索源前缀即可仅搜索对应来源；前缀会自动从实际搜索词中移除。未使用前缀时，仍按当前配置执行原有的多源聚合搜索。

支持的搜索源前缀为 `wy:`、`kg:`、`tx:`、`kw:`、`mg:`。例如，输入 `wy:风说` 时只会在 `wy` 搜索源中检索“风说”。

接口支持 XML 与 `f=json` JSON 响应。写操作要求有效的 Subsonic token 认证；具体认证开关见 `REQUIRE_AUTH` 配置与 `app/rest/[method]/route.ts`。
