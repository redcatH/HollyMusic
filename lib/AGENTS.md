# LIB - Core Business Logic

**Purpose:** Central business logic layer for music streaming application

## STRUCTURE

```
lib/
├── music-source-manager.ts    # Multi-source music provider management
├── cache-manager.ts            # In-memory caching with TTL
├── db.ts                      # Prisma wrapper + checksum-based upsert
├── auth.ts                    # Authentication logic
├── download-manager.ts        # Download queue management
├── config-sync.ts             # Config file synchronization
├── config-validator.ts        # Config validation
├── music-core/                # Music source engine (NetEase API wrapper)
│   └── AGENTS.md
└── server/                    # Server utilities
    └── download-utils.ts      # URL validation, rate limiting, filename sanitization
```

## WHERE TO LOOK

| Task | File | Notes |
|------|------|-------|
| Multi-source routing | music-source-manager.ts | Priority-based, quality fallback |
| Cache access | cache-manager.ts | Exports: searchCache, urlCache |
| Database operations | db.ts | upsertMusicInfo with checksum |
| Download utilities | server/download-utils.ts | isValidUrl, sanitizeFilename, RateLimiter |

## CONVENTIONS

**Export pattern:** Singleton instances for managers and caches
```typescript
export const musicSourceManager = new MusicSourceManager()
export const searchCache = new CacheManager()
export const urlCache = new CacheManager()
```

**Logger:** Always use `import { logger } from '@/lib/logger'` - never console.log

**Error handling:** Log errors with context, then throw with descriptive message

**Config hot reload:** MusicSourceManager checks MD5 hash of config/music-sources.json on each request

## ANTI-PATTERNS

❌ Do NOT use console.log - use logger
❌ Do NOT create new cache managers - use exported singletons
❌ Do NOT bypass checksum validation in db.ts upsert operations
