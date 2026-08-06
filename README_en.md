**free！free！free！free！free！**

Our motto: use all available resources on the internet to get everything for free!

HollyMusic — Local / Self-hosted Music Aggregation Service

HollyMusic is a Next.js + TypeScript frontend focused on aggregating multiple third-party music sources and exposing a unified API for playback, metadata (cover, lyrics), and Subsonic-compatible endpoints.

Key features:
- Plugin-based sources under `custom-sources/` executed via an integrated `LXEnvironmentSimulator`.
- Prisma + SQLite for simple persistence (models include `MusicInfo`, `User`, `Favorite`).
- Subsonic-compatible routes for metadata, cover, lyrics and streaming to ease client integrations.
- Docker-ready with persistent host volumes for the SQLite file.

Repository layout:
- `app/`: Next.js App Router pages and API routes (server entrypoints).
- `components/`: UI components (player, search, layout, etc.).
- `lib/`: backend / business logic (HTTP helpers, source manager, Prisma client wrappers, logger, cache).
- `hooks/`: frontend hooks (`useAudio`, `useSearch`, etc.).
- `custom-sources/`: third-party or custom source scripts (JS) that follow the simulator conventions.
- `prisma/`: Prisma schema, migrations and the default `prisma/data/music.db` (SQLite).
- `lx-env-simulator/`: compatibility layer that executes source scripts and keeps compatibility with upstream scripts.

Quick start (local development)

1. Clone and install dependencies

```powershell
pnpm install
# or
npm install
```

2. Environment

Create `.env` in project root (or copy `.env.example`) and set `DATABASE_URL`:

```text
DATABASE_URL=file:./prisma/data/music.db
# AI features (admin AI recommend tasks + user AI-assisted playlist creation), see .env.example
OPENAI_API_KEY=sk-xxx
# Optional: OPENAI_BASE_URL / OPENAI_MODEL (any OpenAI-compatible endpoint works)
```

3. Initialize local database (recommended)

If this is your first time developing locally, run:

```powershell
# Create migrations and a local DB (interactive, recommended for development)
npx prisma migrate dev --name init

# Or quickly push the schema to DB without generating migrations
npx prisma db push

# Generate Prisma Client (migrate usually runs this automatically)
npx prisma generate
```

4. Start development server

```powershell
pnpm dev
# or npm run dev
```

Visit http://localhost:3000

Notes: local development does not automatically run the same deploy/migrate steps that may be run inside the container at startup. If you see `Error code 14: Unable to open the database file`, confirm:
- `DATABASE_URL` points to an existing, writable path (relative paths are resolved from the project root)
- no other process or container locks the sqlite file (stop any containers that mount the same file first)

Docker (production/test)

The project contains `Dockerfile` and `docker-compose.yml`:

```bash
docker-compose up --build -d
```

The compose file mounts the host folder `./prisma_data` into the container path `/app/prisma/data` to persist the database file. If you need to share the same DB between local dev and container, ensure the mount path is set and the host directory exists.

Custom sources (development & extension)

- Add a new source script: put a JS file into `custom-sources/` and register it in `config/music-sources.json` (see examples in the repository).
- Source scripts should follow the `lx-env-simulator` conventions (implement `musicSearch`, `musicInfo`, `lyric`, `pic`, `musicUrl`, etc.). The project uses `lib/music-source-manager.ts` to load and call these functions.

AI features (optional)

Two built-in AI helpers, both driven by an OpenAI-compatible `/chat/completions` endpoint via `OPENAI_API_KEY`:

- **Admin AI recommend tasks** (dashboard `/admin/recommend`): batch-filter songs by artist/song and write them to the recommend whitelist. A key may be entered in the UI; if absent, it falls back to the server-side `OPENAI_API_KEY`.
- **AI-assisted playlist creation** (user side, `/playlists` → "AI 建歌单"): available to all logged-in users. Describe a need → AI generates candidates → search real songs → AI filters versions → user confirms → playlist created. **Forces the server-side `OPENAI_API_KEY` (never exposed to users)**; only searches sources enabled in the admin dashboard.

Set `OPENAI_API_KEY` (required) plus optional `OPENAI_BASE_URL` (default `https://api.openai.com/v1`; can point to DeepSeek / Qwen / local LMDeploy / any OpenAI-compatible service) and `OPENAI_MODEL` (default `gpt-4o-mini`) in `.env`. If unset: admin tasks require a key in the UI, and user AI playlist creation is unavailable (reports "not configured").

> AI playlist creation is open to all logged-in users, with cost borne server-side. For public deployments, add per-user rate limiting yourself.

Debugging & common issues

- Can't open DB: follow the migration steps above and check file permissions. On Windows, pay attention to file locks and permissions. Avoid concurrent writes from a container and a local process.
- Source script load fails: verify `config/music-sources.json` path and check logs from `lib/music-source-manager.ts` for initialization errors.
- Lyrics / cover fallback order: the code tries local source-provided interfaces (`getLyric` / `getPic`) first, then falls back to external services (e.g. `api.lrc.cx`).

Contributing

- Create feature branches off `main`.
- Keep commits focused and follow a consistent message style (e.g. `feat(source): add new source for XYZ`).
- Run `pnpm lint` before submitting changes.

Resources

- See `docs/` for additional guides: `docs/CONFIG-HOT-RELOAD.md`, `docs/SEARCH-GUIDE.md`, etc.