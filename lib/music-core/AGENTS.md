# MUSIC-CORE - Music Source Engine

**Purpose:** CommonJS music source implementation (NetEase Cloud Music API wrapper)

## STRUCTURE

```
music-core/
├── index.js                   # Main entry point - exports simulator class
├── music-search.js            # Music search API implementation
├── weapi.js                   # WeAPI encryption/signing
├── wy-eapi.js                 # NetEase EAPI wrapper
├── wy-eapi-request.js         # EAPI request handler
├── request.js                 # HTTP request wrapper
├── utils.js                   # Utility functions
└── songList/                  # Playlist management
```

## WHERE TO LOOK

| Task | File | Notes |
|------|------|-------|
| Music search | music-search.js | 20KB, main search logic |
| WeAPI crypto | weapi.js | Request encryption |
| EAPI wrapper | wy-eapi.js | NetEase EAPI calls |
| HTTP requests | request.js | Axios wrapper |
| Playlist ops | songList/ | Song list utilities |

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
