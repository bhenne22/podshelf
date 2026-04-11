# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Podshelf is a self-hosted podcast publishing platform. It provides a public-facing podcast site, an admin UI for episode management, an iTunes-compatible RSS feed, and audio file uploads to SFTP or S3-compatible storage. The database is embedded SQLite (`better-sqlite3`, synchronous API).

## Commands

```bash
npm run dev        # Development server
npm run build      # Production build
npm run preview    # Preview production build
npm run typecheck  # TypeScript type checking (requires `nuxi prepare` first)
```

No test suite exists.

## Architecture

### Full-Stack Nuxt 3

Nuxt handles both frontend (Vue 3, file-based routing in `pages/`) and backend (Nitro/h3 server, API routes in `server/api/`). There is no separate backend process.

### Pages & Routing

- `/` — Public podcast homepage (episode list)
- `/episodes/[slug]` — Public episode detail with audio player
- `/admin/login` — Password login
- `/admin/` — Admin dashboard
- `/admin/settings` — Podcast metadata
- `/admin/episodes` — Episode CRUD (list, new, edit via `/admin/episodes/[id]`)

Admin pages are protected by `middleware/admin-auth.ts` (client-side cookie check). All mutation API endpoints are protected server-side by `requireAuth()` from `server/utils/auth.ts`, which accepts either:
- An HMAC-signed session cookie (`admin_session`) — set by `POST /api/auth/login`, cleared by `POST /api/auth/logout`
- An API key via `X-Api-Key: <key>` or `Authorization: Bearer <key>` header — for automation (OpenClaw, scripts)

If `ADMIN_PASSWORD` is not set (dev mode), all access is open.

### API Endpoints

All endpoints are under `server/api/`:

- `GET/POST /api/episodes` — List (filtered by `?status=` or `?slug=`) or create
- `PATCH/DELETE /api/episodes/[id]` — Update or delete
- `GET/POST /api/settings` — Podcast metadata (key-value store in `settings` table)
- `POST /api/upload` — Multipart audio upload (audio types only, 500 MB limit), routed to SFTP or S3 adapter
- `POST /api/auth/login` — Authenticate with admin password, returns signed session cookie
- `POST /api/auth/logout` — Clear session cookie

RSS feed lives at `server/routes/feed.xml.ts` → `GET /feed.xml`.

### Database

SQLite via `better-sqlite3` (sync, no async/await). Singleton initialized in `server/db/index.ts`, schema in `server/db/schema.sql`. Two tables:

- `episodes` — title, slug (unique), episode_number, season_number, description, audio_url, status (`draft`|`published`), etc.
- `settings` — key/value store seeded with podcast metadata defaults

### Storage Adapters

`server/storage/sftp.ts` and `server/storage/s3.ts`. Selected via `STORAGE_ADAPTER` env var (`"sftp"` or `"s3"`). S3 adapter supports AWS, Backblaze B2, Cloudflare R2, and any S3-compatible endpoint.

### Styling

Plain scoped CSS in Vue SFCs — no Tailwind, no UI library. Keep it that way.

### Episode Creation via API / AI Assistant

Full API documentation is in `docs/api.md`. The typical AI-assisted workflow is:

1. **Upload audio:** `POST /api/upload` with `file` form field → returns `{ url, filename, size }`
2. **Create draft:** `POST /api/episodes` with title, description, audio_url, etc. → returns episode object

Both endpoints require `X-Api-Key: <PODSHELF_API_KEY>` header.

A convenience script wraps both steps:

```bash
./scripts/podshelf-publish.sh \
  --file /path/to/episode.mp3 \
  --title "Episode Title" \
  --description "<p>Show notes</p>" \
  --tags "running, ultramarathon"
```

Or with an existing audio URL (skip upload):

```bash
./scripts/podshelf-publish.sh \
  --audio-url "https://example.com/episode.mp3" \
  --title "Episode Title" \
  --description "<p>Show notes</p>"
```

Requires `PODSHELF_API_KEY` env var. Episodes are created as drafts by default.

### OpenClaw Automation (Legacy)

`openclaw/podshelf-watch.sh` is a bash script that watches a directory for new episode folders, uploads audio files, optionally generates show notes via `claude -p`, creates draft episodes via the Podshelf API, and sends Discord notifications. Folders are renamed to `.processed` after ingestion.

## Environment Variables

Defined in `.env.example`. Key vars:

| Variable | Purpose |
|---|---|
| `DATABASE_PATH` | SQLite file path (default: `./data/podshelf.db`) |
| `ADMIN_PASSWORD` | Admin UI password (if unset, auth is disabled for dev) |
| `NUXT_SECRET_KEY` | Used to sign session tokens (falls back to `ADMIN_PASSWORD`) |
| `PODSHELF_API_KEY` | API key for automation/scripts — sent as `X-Api-Key` or `Authorization: Bearer` |
| `SITE_URL` | Public podcast URL (used in RSS feed) |
| `STORAGE_ADAPTER` | `sftp` or `s3` |
| `SFTP_HOST`, `SFTP_USER`, `SFTP_PRIVATE_KEY_PATH`, `SFTP_REMOTE_DIR`, `SFTP_PUBLIC_URL_BASE` | SFTP config |
| `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET_NAME`, `S3_PUBLIC_URL_BASE` | S3 config |
