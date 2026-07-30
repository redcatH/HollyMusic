# PROJECT KNOWLEDGE BASE

**Generated:** 2026-01-25
**Mode:** Update

## OVERVIEW

HollyMusic - Next.js-based music streaming application with multi-source music provider support. Core stack: Next.js 16, React 19, TypeScript 5, Prisma (SQLite), Tailwind CSS v4.

## STRUCTURE

```
./
├── app/              # Next.js App Router (pages + API routes)
├── components/       # React UI components
├── lib/              # Core business logic (see lib/AGENTS.md)
│   ├── music-core/   # Music source engine (CommonJS)
│   └── server/       # Server-side utilities
├── hooks/            # React hooks (useAudio, useSearch, etc.)
├── custom-sources/   # Third-party music source scripts
├── prisma/           # Database schema + migrations (SQLite)
├── config/           # App configuration
└── docs/             # Additional documentation
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Music source management | lib/music-source-manager.ts | Multi-source priority, quality fallback |
| Database operations | lib/db.ts | Prisma wrapper with upsert + checksum |
| Caching | lib/cache-manager.ts | In-memory with TTL |
| API routes | app/api/ | Next.js route handlers |
| Custom music sources | custom-sources/ | Register in config/music-sources.json |
| Download utilities | lib/server/download-utils.ts | URL validation, rate limiting |

## CONVENTIONS

**Deviations from standard:**
- Uses `@/*` path alias (root relative)
- Logger: `import { logger } from '@/lib/logger'` (not console.log)
- Cache: `import { searchCache, urlCache } from '@/lib/cache-manager'`
- Naming: PascalCase components, camelCase functions, UPPER_SNAKE_CASE constants

**Import order:**
1. External libraries (React, Next.js, third-party)
2. Internal modules (`@/` paths)
3. Relative paths (`./`, `../`)

## ANTI-PATTERNS (THIS PROJECT)

1. ❌ Do NOT use `console.log` in production → use logger
2. ❌ Do NOT ignore TypeScript type errors
3. ❌ Do NOT commit `.env` files
4. ❌ Do NOT call server APIs directly from components → use API routes
5. ❌ Do NOT operate DOM directly → use React refs

## COMMANDS

```bash
# Development
npm run dev              # Start dev server (Next.js)
npm run dev:turbo        # Turbo mode dev server

# Build & Production
npm run build            # Production build
npm start                # Start production server

# Code Quality
npm run lint             # ESLint

# Database (Prisma + SQLite)
npx prisma migrate dev   # Create migration (dev)
npx prisma db push      # Sync schema without migration
npx prisma generate      # Generate Prisma client
npx prisma studio        # Open Prisma Studio

# Analysis
npm run analyze          # Bundle analyzer
```

## NOTES

**Gotchas:**
- SQLite file lock: Ensure no Docker container + local process access same `.db` file
- Music source hot reload: Config file changes trigger automatic reload via MD5 hash check
- Quality fallback: `flac24bit` → `flac` → `320k` → `128k`
- TypeScript strict mode: Enabled
- LSP unavailable: typescript-language-server not installed (not blocking)

**Database:**
- Path: `prisma/data/music.db` (relative to project root)
- ORM: Prisma with SQLite
- Migrations: Auto-generated via `npx prisma migrate dev`

**Music Sources:**
- Load scripts from `custom-sources/` directory
- Register in `config/music-sources.json`
- Must implement: `musicSearch`, `musicInfo`, `lyric`, `pic`, `musicUrl`
- Managed by `MusicSourceManager` class with priority-based routing

**State Management:**
- Local: React hooks (useState, useReducer)
- Global: zustand
- Server: API + caching

**Styling:**
- Tailwind CSS v4
- Utility: `cn()` from `@/lib/utils` for class merging
- Icons: lucide-react

**Testing:**
- Manual testing only (no automated tests)
- Use API tools (Postman, test.http) for API testing
