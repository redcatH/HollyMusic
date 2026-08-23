# MUSIC-CORE - lx Custom-Source Compatibility Engine

**Purpose:** CommonJS music source engine (NetEase Cloud Music API wrapper) loaded by MusicSourceManager via `require()` to serve lx custom-source script compatibility.

## SCOPE

**music-core 冻结为「洛雪音源兼容引擎」**：只维护 lx 必需接口（musicSearch / musicInfo / lyric / pic / musicUrl）的 CommonJS 实现。

- ❌ 不要在此新增平台能力（歌单 / 榜单 / 发现页 / 歌词缓存等）。平台适配若分散在 JS 与 TS 两条线，上游接口每次改版都要双份维护。
- ✅ 内置平台适配一律用 TypeScript：发现页（榜单 / 歌单）→ `lib/services/discovery-service.ts`；服务端原生歌词 → `lib/server/music-lyric.ts`。
- 历史背景：`songList/`（lx wy/songList.js 的 eapi 服务端移植，从未接入任何 API）已于 2026-08 移除；网易歌单唯一实现为 discovery-service.ts 的公开接口版。

## STRUCTURE

```
music-core/
├── index.js                   # Main entry point - exports simulator class
├── music-search.js            # Music search API implementation
├── weapi.js                   # WeAPI encryption/signing
├── wy-eapi.js                 # NetEase EAPI wrapper
├── wy-eapi-request.js         # EAPI request handler
├── request.js                 # HTTP request wrapper
└── utils.js                   # Utility functions
```

## WHERE TO LOOK

| Task | File | Notes |
|------|------|-------|
| Music search | music-search.js | 20KB, main search logic |
| WeAPI crypto | weapi.js | Request encryption |
| EAPI wrapper | wy-eapi.js | NetEase EAPI calls |
| HTTP requests | request.js | Axios wrapper |

## CONVENTIONS

**Module system:** CommonJS (require/module.exports) - used by MusicSourceManager via require()
**Export pattern:** module.exports for functions/objects
**Async handling:** Promise-based API with error handling

**Loaded by:** MusicSourceManager via `require('./music-core/index')`

**Required interface:** Exports class implementing:
- musicSearch(source, query)
- musicInfo(source, songmid)
- lyric(source, musicInfo)
- pic(source, musicInfo)
- musicUrl(source, musicInfo, quality)

## ANTI-PATTERNS

❌ Do NOT convert to ES modules (breaks require() loader)
❌ Do NOT modify WeAPI encryption logic unless necessary for API changes
❌ Do NOT add new features here - use custom-sources/ for new music sources
❌ Do NOT add platform capabilities here (playlists / toplists / discovery) - see SCOPE, use TypeScript in lib/services or lib/server instead
