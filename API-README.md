# 音乐播放器 API 文档

## 概述

这是一个基于 Next.js 的音乐播放器后端 API，支持多音源搜索和智能播放链接获取。

## 技术栈

- **Next.js 16.0.3** (App Router)
- **React 19.2.0**
- **TypeScript 5**
- **Tailwind CSS 4**
- **Howler.js** (音频播放)
- **needle** (HTTP 请求)
- **自定义音源系统** (基于 LX Music)

## API 端点

### 1. 音乐搜索

**端点**: `GET /api/search`

**参数**:
- `source` (必填): 音源，支持 `kw` (酷我), `kg` (酷狗), `tx` (QQ音乐), `wy` (网易云), `mg` (咪咕)
- `keyword` (必填): 搜索关键词
- `page` (可选): 页码，默认 1
- `limit` (可选): 每页数量，默认 30，最大 100

**示例请求**:
```bash
curl "http://localhost:3000/api/search?source=kw&keyword=周杰伦&page=1&limit=30"
```

**响应**:
```json
{
  "success": true,
  "data": {
    "list": [
      {
        "name": "晴天",
        "singer": "周杰伦",
        "source": "kw",
        "songmid": "12345",
        "albumName": "叶惠美",
        "interval": "04:28",
        "types": [
          { "type": "128k", "size": "4.2M" },
          { "type": "320k", "size": "10.5M" }
        ],
        "_types": {
          "128k": { "size": "4.2M" },
          "320k": { "size": "10.5M" }
        }
      }
    ],
    "total": 100,
    "page": 1,
    "allPage": 4,
    "limit": 30,
    "source": "kw"
  }
}
```

**缓存**: 30 分钟

---

### 2. 获取播放链接

**端点**: `POST /api/music-url`

**请求体**:
```json
{
  "musicInfo": {
    "name": "晴天",
    "singer": "周杰伦",
    "source": "kw",
    "songmid": "12345",
    "_types": {
      "128k": { "size": "4.2M" },
      "320k": { "size": "10.5M" }
    }
  },
  "quality": "320k"
}
```

**参数**:
- `musicInfo` (必填): 歌曲信息对象（来自搜索结果）
- `quality` (可选): 音质，支持 `128k`, `320k`, `flac`, `flac24bit`，默认 `320k`

**示例请求**:
```bash
curl -X POST http://localhost:3000/api/music-url \
  -H "Content-Type: application/json" \
  -d '{
    "musicInfo": {
      "name": "晴天",
      "singer": "周杰伦",
      "source": "kw",
      "songmid": "12345",
      "_types": {
        "320k": { "size": "10.5M" }
      }
    },
    "quality": "320k"
  }'
```

**响应**:
```json
{
  "success": true,
  "data": {
    "url": "https://example.com/music/12345.mp3"
  }
}
```

**特性**:
- 智能音质降级：如果请求的音质不可用，自动尝试更低音质
- 多音源支持：按优先级依次尝试所有配置的音源
- 缓存: 10 分钟

---

### 3. 健康检查

**端点**: `GET /api/health`

**示例请求**:
```bash
curl http://localhost:3000/api/health
```

**响应**:
```json
{
  "success": true,
  "data": {
    "initialized": true,
    "timestamp": "2025-11-19T10:30:00.000Z",
    "sources": [
      {
        "source": "野花🌷",
        "name": "野花🌷",
        "enabled": true,
        "initialized": true,
        "initTime": 1234,
        "supportedSources": ["kw", "kg", "tx", "wy", "mg"],
        "supportedActions": {
          "kw": ["musicUrl"],
          "kg": ["musicUrl"]
        },
        "supportedQualities": {
          "kw": ["128k", "320k"],
          "kg": ["128k", "320k", "flac"]
        }
      }
    ],
    "summary": {
      "total": 1,
      "initialized": 1,
      "failed": 0
    }
  }
}
```

---

### 4. 清理缓存

**端点**: `POST /api/cache/clear`

**请求体**:
```json
{
  "type": "all"
}
```

**参数**:
- `type` (可选): 缓存类型，支持 `all` (全部), `search` (搜索), `url` (播放链接)，默认 `all`

**示例请求**:
```bash
curl -X POST http://localhost:3000/api/cache/clear \
  -H "Content-Type: application/json" \
  -d '{"type": "all"}'
```

**响应**:
```json
{
  "success": true,
  "data": {
    "type": "all",
    "before": {
      "search": { "size": 10, "hits": 50, "misses": 5, "hitRate": "90.91%" },
      "url": { "size": 20, "hits": 100, "misses": 10, "hitRate": "90.91%" }
    },
    "after": {
      "search": { "size": 0, "hits": 0, "misses": 0, "hitRate": "0.00%" },
      "url": { "size": 0, "hits": 0, "misses": 0, "hitRate": "0.00%" }
    },
    "message": "成功清理所有缓存"
  }
}
```

---

## 错误响应

所有错误响应遵循统一格式：

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "错误描述",
    "details": "详细错误信息（可选）"
  }
}
```

**错误码**:
- `INVALID_PARAMS`: 参数错误
- `SOURCE_NOT_SUPPORTED`: 不支持的音源
- `SEARCH_FAILED`: 搜索失败
- `ALL_SOURCES_FAILED`: 所有音源获取播放链接失败
- `URL_FETCH_FAILED`: 获取播放链接失败
- `QUALITY_NOT_SUPPORTED`: 不支持的音质
- `INTERNAL_ERROR`: 内部错误

---

## 配置

### 音源配置

编辑 `config/music-sources.json` 添加或修改音源：

```json
{
  "sources": [
    {
      "path": "custom-sources/flower-v1-de.js",
      "enabled": true,
      "priority": 1,
      "timeout": 15000,
      "name": "野花🌷",
      "description": "Flower 自定义源"
    }
  ]
}
```

**字段说明**:
- `path`: 自定义源脚本文件的相对路径
- `enabled`: 是否启用该音源
- `priority`: 优先级，数字越小优先级越高
- `timeout`: 请求超时时间（毫秒）
- `name`: 音源名称（可选）
- `description`: 音源描述（可选）

参考 `config/music-sources.example.json` 获取完整配置示例。

---

## 开发

### 安装依赖
```bash
pnpm install
```

### 启动开发服务器
```bash
pnpm dev
```

### 构建生产版本
```bash
pnpm build
pnpm start
```

---

## 日志

系统使用内置的日志管理器，根据环境自动调整日志级别：

- **开发模式** (`NODE_ENV=development`): 显示 DEBUG 级别及以上的日志
- **生产模式**: 显示 INFO 级别及以上的日志

日志格式：
```
[2025-11-19T10:30:00.000Z] [INFO] 消息内容
```

---

## 缓存策略

- **搜索结果**: 缓存 30 分钟
- **播放链接**: 缓存 10 分钟
- **自动清理**: 每 5 分钟自动清理过期缓存

---

## 注意事项

1. 自定义源脚本必须符合 LX Music 的脚本规范
2. 首次请求可能需要初始化音源，会稍慢
3. 播放链接有时效性，建议使用缓存的链接
4. 建议定期检查 `/api/health` 端点确保音源正常工作

---

## License

MIT
