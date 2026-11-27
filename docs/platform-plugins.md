# 平台插件开发指南

[返回项目首页](../README.md) · [离线 demo 插件](../examples/platform-plugins/demo-catalog.js) · [平台插件架构](platform-plugins-design.md)

平台插件从 `v0.33.0-preview.4` 起可用，用于为搜索、发现和 Subsonic `search3` 提供目录数据。歌曲 ID 应与播放音源约定一致，实际播放和下载由已启用的兼容 LX 音源提供。仓库只提供离线 demo，不包含真实平台适配脚本。

## 编写第一个插件

将下面的代码保存为 UTF-8 编码的 `demo-catalog.js`。它在一个包内注册两个演示平台，共用同一个搜索处理函数。导入后搜索「示例」，即可查看两个平台各自返回的演示歌曲。

```js
function searchSongs({ keyword, cursor, limit }, { platform }) {
  const songs = [
    { id: '001', name: '示例歌曲一', artist: platform, durationMs: 180000 },
    { id: '002', name: '示例歌曲二', artist: platform, durationMs: 210000 },
  ]
  const matches = songs.filter(song => song.name.includes(keyword))
  const start = Number(cursor ?? '0')
  const end = start + limit
  const hasMore = end < matches.length

  return {
    items: matches.slice(start, end),
    hasMore,
    nextCursor: hasMore ? String(end) : undefined,
    total: matches.length,
  }
}

holly.register({
  apiVersion: 1,
  id: 'demo-catalog',
  name: '目录插件示例',
  version: '1.0.0',
  platforms: [
    { id: 'demoa', name: '演示平台 A', origins: [], handlers: { searchSongs } },
    { id: 'demob', name: '演示平台 B', origins: [], handlers: { searchSongs } },
  ],
})
```

- 脚本为单个 `.js` 文件，最大 256 KB。顶层同步调用一次 `holly.register`。在 `handlers` 中提供实际实现的函数，网络请求放在处理函数内。
- 包 `id` 长 2–64 字符，以小写字母开头，后续可用小写字母、数字和连字符。发布新内容时保持包 `id`，递增 `version`，例如 `1.0.0` → `1.0.1`。同一包的同一版本只能对应同一份脚本。
- `platforms` 可含 1–16 个平台。平台 ID 长 1–16 字符，以小写字母开头，后续可用小写字母和数字。`all` 保留为聚合搜索标识，`qs` 对应汽水音乐。跨搜索、歌单和榜单复用同一平台 ID 和上游歌曲 ID，便于正确关联收藏、播放和历史。

## 能力与入参

处理函数采用 `(input, context)` 签名，可以直接返回对象或返回 Promise。宿主传入本次最多返回的条目数 `input.limit`，首屏的 `input.cursor` 为空。共用处理函数可读取 `context.platform` 判断当前平台。

| 处理函数 | `input` 中的业务参数 | `items` 内容 |
| --- | --- | --- |
| `searchSongs` | `keyword`、`cursor?`、`limit` | 歌曲 |
| `searchPlaylists` | `keyword`、`cursor?`、`limit` | 歌单 |
| `listPlaylistCategories` | `limit` | 分类 |
| `listPlaylists` | `categoryId?`、`cursor?`、`limit` | 推荐或分类歌单 |
| `getPlaylist` | `id`、`cursor?`、`limit` | 歌曲，同时返回 `collection` |
| `listCharts` | `limit` | 榜单 |
| `getChart` | `id`、`cursor?`、`limit` | 歌曲，同时返回 `collection` |
| `listRadioStations` | `limit` | 漫游电台或场景 |
| `getRadioTracks` | `id`、`cursor?`、`limit` | 歌曲，同时返回 `collection` |

注册歌单分类时，同一平台还须实现 `listPlaylists`。`categoryId` 为空时返回推荐歌单。希望发现页中的歌单、榜单或电台可打开时，一并实现对应的详情函数。歌曲插件启用后，单曲搜索可用于网页和 Subsonic 客户端。

## 返回值与分页

每次返回 `{ items, hasMore, nextCursor?, total?, collection? }`。`items` 为数组，长度须小于或等于 `limit`，`hasMore` 为布尔值。存在下一页时返回非空且不同于本次游标的 `nextCursor` 字符串，最长 8192 字符。`total` 可填可信的非负整数。无匹配项时返回 `{ items: [], hasMore: false }`，上游请求或响应异常时抛出错误。三个详情函数都须返回 `collection`，即使当前页没有歌曲。

| 对象 | 必填字段 | 常用可选字段 |
| --- | --- | --- |
| 歌曲 | `id`、`name` | `artist`、`album`、`albumId`、`cover`、`durationMs`、`qualities` |
| 歌单、榜单、电台及详情 `collection` | `id`、`name` | `author`、`cover`、`description`、`songCount`、`playCount` |
| 分类 | `id`、`name` | |

- 条目 `id` 是 1–128 字符的字符串，可用英文字母、数字、下划线、点、冒号及连字符。`qs` 的歌曲 ID 只接受 1–24 位数字字符串。处理长数字 ID 时，从上游读取并保留字符串，避免 JavaScript `Number` 丢失精度。
- `durationMs` 使用整数毫秒。`cover` 使用完整的 HTTPS 图片地址。上游拆分域名、路径或模板时，先在插件内拼出完整地址，参考[离线 demo](../examples/platform-plugins/demo-catalog.js)。
- `qualities` 接受音质字符串，如 `['320k', 'flac']`，也可传 `{ type, size?, sizeBytes?, hash? }` 对象。支持 `128k`、`320k`、`flac`、`flac24bit`（可写 `hires`）、`master`、`atmos`、`atmos_plus`。仅填写上游已确认的档位，未知时省略。取流时会再结合已启用音源支持的档位。
- 部分 LX 音源还需要 `hash`、`strMediaMid`、`albumMid`、`albumAudioId`、`copyrightId` 或 `upstreamSongId`。根据目标平台和音源填写对应的上游原值。[完整字段契约](../lib/server/platform-plugin-contract.ts)

## 请求上游 JSON

通过 `context.request(url, options?)` 发起请求。`origins` 声明该平台可访问的 HTTPS origin，例如 `https://api.example.com`，省略路径、末尾斜杠和端口。每个平台最多声明 12 个 origin，共用函数的请求权限随本次调用的平台变化。

```js
const data = await request(
  `https://api.example.com/search?q=${encodeURIComponent(keyword)}&limit=${limit}`,
)
const page = await request('https://api.example.com/playlist', {
  method: 'POST',
  body: { id, cursor, limit },
})
```

默认使用 `GET`。`POST` 的对象请求体由宿主编码为 JSON。请求成功时返回解析后的 JSON，HTTP 错误、非 JSON 响应和被网络策略拒绝的请求会使 Promise 失败。每次能力执行最多发起 12 个请求，执行时限为 12 秒。插件脚本在隔离环境运行，依赖需写进单文件，使用宿主管理的请求接口。

## 导入与验证

1. 用管理员账号打开「系统管理 → 平台插件」，点击「导入脚本」，选择 `.js` 文件。声明校验通过后，功能会自动启用；若已有其他插件提供同一功能，面板会显示当前提供方供管理员切换。
2. 展开「功能测试（可选）」，先测单曲或歌单搜索。演示脚本使用关键词「示例」。上游返回合法空页时，普通页面会显示无结果，后台功能测试会提示更换样本。
3. 测试歌单、榜单或电台详情时，先测试相应列表，页面会自动填入第一个条目的 ID。再到搜索和发现页验证结果、封面和翻页。有播放需求时，在「音源管理」用真实歌曲验证音源取流。
4. 修改脚本后递增 `version` 并重新导入。在同一包的新版中移除的功能会停用。需要恢复时，可在变更记录回滚仍保留的版本。删除插件或版本后，如需恢复该文件，请重新导入。

真实平台适配涉及平台条款、数据来源和音频版权。请自行确认授权并在你的部署环境中维护脚本，不要把真实平台密钥、接口脚本或用户凭据提交到公共仓库。

| 现象 | 检查项 |
| --- | --- |
| 找不到「平台插件」或页面提示数据库表不存在 | 确认运行 `v0.33.0-preview.4` 或更新的版本。官方 Docker 镜像启动时自动迁移，源码部署按开发指南运行迁移。 |
| 测试提示请求失败 | 核对该平台的 `origins`、重定向目标、服务器网络和上游响应的 JSON 格式。 |
| 测试提示分页或条目标识无效 | 检查 `items` 长度、布尔值 `hasMore`、字符串 ID，以及详情方法返回的 `collection`。 |
| 能搜索、找得到歌单，播放失败 | 确认音源管理启用了该平台，核对插件歌曲 ID 与音源要求的歌曲 ID，随后做一次音源测试。 |

[本地运行与数据库迁移](DEVELOPMENT.md) · [LX 音源测试](source-testing.md)
