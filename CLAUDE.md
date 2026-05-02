# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Podshelf is a self-hosted, **multi-tenant** podcast publishing platform. One installation hosts many podcasts; each podcast has its own settings, storage credentials, episodes, members, and RSS feed. The database is embedded SQLite (`better-sqlite3`, synchronous API). The platform is headless by default — it produces an iTunes-compatible RSS feed (and optionally fires GitHub `repository_dispatch` events to rebuild a static site) but doesn't itself serve a public listener-facing website.

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

- `/` — redirects to `/admin`
- `/admin/login` — password login
- `/admin/` — list of podcasts the user can access
- `/admin/podcasts/new` — create podcast (admin only)
- `/admin/inactive-podcasts` — admin-only purge / restore for soft-deleted podcasts
- `/admin/users`, `/admin/api-keys` — user + key management
- `/admin/[podcast]/episodes` — episode list for a podcast (with season + date-range filters and Overall # / Season # / Ep # columns)
- `/admin/[podcast]/episodes/new`, `/admin/[podcast]/episodes/[id]` — episode CRUD
- `/admin/[podcast]/settings` — podcast metadata (paste-URL or upload artwork; soft-delete in Danger Zone)
- `/admin/[podcast]/storage` — per-podcast SFTP / S3 credentials, plus separate audio + artwork directories
- `/admin/[podcast]/files` — file browser for the audio + artwork directories (list, upload, rename, delete, copy URL, in-use warning)
- `/admin/[podcast]/build`, `/admin/[podcast]/stats`, `/admin/[podcast]/members`, `/admin/[podcast]/import-rss` — build dispatch, analytics, membership, RSS import

Admin pages are protected by `middleware/admin-auth.ts` (client-side cookie check). API endpoints are protected server-side by `requireAuth` / `requirePodcastAccess` / `requireAdmin` from `server/utils/auth.ts`, accepting either:
- An HMAC-signed session cookie (`admin_session`) — set by `POST /api/auth/login`, cleared by `POST /api/auth/logout`
- An API key via `X-Api-Key: <key>` or `Authorization: Bearer <key>` header — for automation. API keys can be scoped to specific podcasts and have a `read|write|full` permission level.

### API Endpoints

All under `server/api/`. The full reference is in `docs/api.md`. The shapes most commonly touched:

- `GET/POST /api/podcasts` — list / create (admin only for create)
- `GET /api/podcasts/[slug]`, `PATCH …`, `DELETE …` (soft-delete), `POST .../restore`, `DELETE .../purge` (admin-only hard delete)
- `GET /api/admin/inactive-podcasts` — admin list of soft-deleted podcasts
- `GET/POST /api/podcasts/[slug]/episodes`, `PATCH/DELETE /api/podcasts/[slug]/episodes/[id]`
- `POST /api/podcasts/[slug]/upload?kind=audio|artwork` — multipart upload (audio: 500 MB, image MIME types: 25 MB)
- `GET /api/podcasts/[slug]/files?kind=…`, `POST .../files/delete`, `POST .../files/rename`
- `GET/POST /api/podcasts/[slug]/storage`, `POST .../storage/test`
- `GET/POST /api/podcasts/[slug]/github`, `POST .../github/test`, `POST .../github/trigger` — GitHub `repository_dispatch` integration

RSS feed lives at `server/routes/feeds/[slug].xml.ts` → `GET /feeds/[slug].xml`. Returns 404 when the podcast is soft-deleted (`status='inactive'`).

### Database

SQLite via `better-sqlite3` (sync, no async/await). Singleton initialized in `server/db/index.ts`; canonical schema in `server/db/schema.sql` (mirrored inline as `SCHEMA_SQL` in `server/db/index.ts` to dodge file-read issues in Nitro production builds — keep both in sync). Idempotent `ALTER` migrations live in `applyMigrations` in `server/db/index.ts` for backward-compatible additions.

Tables: `users`, `podcasts` (per-tenant config + soft-delete `status` / `deleted_at`), `podcast_users` (membership), `api_keys`, `api_key_podcasts` (key scope), `episodes` (per-podcast, with `image_url`/`image_filename` for per-episode artwork), `downloads`.

### Storage Adapters

`server/storage/sftp.ts` and `server/storage/s3.ts`. Each podcast has its own adapter selection and credentials (encrypted at rest with `PODSHELF_ENCRYPTION_KEY`). Each adapter supports two directories per podcast:

- **audio** (`remoteDir` / `publicUrlBase` for SFTP; bucket root + `publicUrlBase` for S3)
- **artwork** (`artworkRemoteDir` / `artworkPublicUrlBase` for SFTP; `artworkPrefix` + `artworkPublicUrlBase` for S3 — falls back to audio URL base when blank)

Helpers: `resolveSftpTarget`, `resolveS3Target` in `server/utils/storage-config.ts` — pass `'audio' | 'artwork'` to get the appropriate dir + URL base. Upload/list/delete/rename functions all take a `kind` param and route accordingly.

### Styling

Plain scoped CSS in Vue SFCs — no Tailwind, no UI library. Keep it that way.

### Episode Creation via API / AI Assistant

Full API documentation is in `docs/api.md`. The typical AI-assisted workflow is:

1. **Upload audio:** `POST /api/podcasts/[slug]/upload` with `file` form field → returns `{ url, filename, size, kind }`
2. **(Optional) upload artwork:** `POST /api/podcasts/[slug]/upload?kind=artwork` → returns same shape; pass `url` + `filename` as `image_url` + `image_filename`
3. **Create draft:** `POST /api/podcasts/[slug]/episodes` with title, description, audio_url, etc. → returns episode object

All endpoints require `X-Api-Key: <PODSHELF_API_KEY>` header (key can be scoped to a single podcast).

A convenience script wraps the audio + create steps:

```bash
./scripts/podshelf-publish.sh \
  --podcast yousaid100miles \
  --file /path/to/episode.mp3 \
  --title "Episode Title" \
  --description "<p>Show notes</p>" \
  --tags "running, ultramarathon"
```

Or with an existing audio URL (skip upload):

```bash
./scripts/podshelf-publish.sh \
  --podcast yousaid100miles \
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
| `NUXT_SECRET_KEY` | Used to sign session tokens |
| `PODSHELF_ENCRYPTION_KEY` | AES-256-GCM key encrypting per-podcast SFTP / S3 / GitHub-token blobs |
| `SITE_URL` | Public Podshelf URL (used in RSS feed `<link>` and tracking redirects) |
| `GEOIP_DB_PATH` | Optional GeoLite2 City database for download geo-stats |

Storage credentials are **not** environment variables — they're configured per podcast through the admin UI's Storage tab and stored encrypted in the database. The pre-multi-tenant `STORAGE_ADAPTER`, `SFTP_*`, `S3_*` env vars are gone.
