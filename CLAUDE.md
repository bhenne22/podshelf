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

`/admin/*` is reserved for true platform-admin functionality. Everything regular podcast members touch lives outside `/admin/`.

User-facing routes (login required):
- `/login` — password login
- `/` — list of podcasts the user can access (the dashboard)
- `/api-keys` — per-user API key management
- `/podcasts/[slug]` — per-podcast dashboard
- `/podcasts/[slug]/episodes` — episode list (with season + date-range filters and Overall # / Season # / Ep # columns)
- `/podcasts/[slug]/episodes/new`, `/podcasts/[slug]/episodes/[id]` — episode CRUD (transcript + chapters file/textarea, per-episode RSS overrides, people attachments)
- `/podcasts/[slug]/people` — per-podcast roster of hosts/guests (powers `<podcast:person>` tags in the feed)
- `/podcasts/[slug]/settings` — podcast metadata (paste-URL or upload artwork; soft-delete in Danger Zone)
- `/podcasts/[slug]/storage` — per-podcast SFTP / S3 credentials, plus separate audio + artwork directories
- `/podcasts/[slug]/files` — file browser for the audio + artwork directories (list, upload, rename, delete, copy URL, in-use warning)
- `/podcasts/[slug]/build`, `/podcasts/[slug]/stats`, `/podcasts/[slug]/members`, `/podcasts/[slug]/import-rss` — build dispatch, analytics, membership, RSS import
- `/podcasts/[slug]/audit` — chronological audit log of every change (visible to all members)

Admin-only routes (`is_admin` required):
- `/admin/users` — user management
- `/admin/podcasts/new` — create a new podcast
- `/admin/inactive-podcasts` — purge / restore soft-deleted podcasts

Two route middlewares enforce these:
- `middleware/auth.ts` — login required (used by all user-facing pages above)
- `middleware/admin-only.ts` — login + `is_admin` required (used by `/admin/*` pages); non-admins bounce to `/`, unauthenticated callers bounce to `/login`

API endpoints are protected server-side by `requireAuth` / `requirePodcastAccess` / `requireAdmin` from `server/utils/auth.ts`, accepting either:
- An HMAC-signed session cookie (`session`) — set by `POST /api/auth/login`, cleared by `POST /api/auth/logout`
- An API key via `X-Api-Key: <key>` or `Authorization: Bearer <key>` header — for automation. API keys can be scoped to specific podcasts and have a `read|write|full` permission level.

### API Endpoints

All under `server/api/`. The full reference is in `docs/api.md`. The shapes most commonly touched:

- `GET/POST /api/podcasts` — list / create (admin only for create)
- `GET /api/podcasts/[slug]`, `PATCH …`, `DELETE …` (soft-delete), `POST .../restore`, `DELETE .../purge` (admin-only hard delete)
- `GET /api/admin/inactive-podcasts` — admin list of soft-deleted podcasts
- `GET/POST /api/podcasts/[slug]/episodes`, `PATCH/DELETE /api/podcasts/[slug]/episodes/[id]`
- `POST /api/podcasts/[slug]/episodes/[id]/chapters` — parses a textarea-style chapters list, uploads JSON sidecar to audio storage, persists `chapters_url`
- `GET/POST/PATCH/DELETE /api/podcasts/[slug]/people` (+ `[id]`) — per-podcast roster
- `GET/POST/DELETE /api/podcasts/[slug]/episodes/[id]/people` (+ `/[attachId]`) — per-episode attachments; `role`/`group` frozen at attach time
- `POST /api/podcasts/[slug]/episodes/[id]/duplicate` — clone an episode into a fresh draft, carries description/tags/image/season/etc + people attachments, clears audio/chapters/transcript/numbers/dates
- `GET /api/podcasts/[slug]/episodes/template` — returns rendered title/description templates + suggested next season/episode numbers for the New Episode form to pre-fill
- `GET /api/podcasts/[slug]/aliases` — list of old slugs that still serve the feed
- `GET /api/podcasts/[slug]/export.json`, `POST .../import-json` — full Podshelf-archive JSON export / import (settings, episodes incl drafts/scheduled, people, aliases; excludes secrets/members)
- `POST /api/podcasts/[slug]/storage/migrate`, `GET .../storage/migrate` — queue and monitor end-to-end storage migration (file copy + URL rewrite + config swap)
- `POST /api/podcasts/[slug]/upload?kind=audio|artwork|transcript|chapters` — multipart upload (audio: 500 MB, image: 25 MB, transcript: 10 MB, chapters JSON: 2 MB; transcripts + chapters land in the audio directory as sidecar files)
- `GET /api/podcasts/[slug]/audit?limit=50&before=<id>` — paginated per-podcast audit log
- `GET/POST /api/podcasts/[slug]/webhook`, `POST .../webhook/test` — per-podcast publish-webhook config (URL encrypted at rest, format selector for discord/slack/generic)
- `GET /api/podcasts/[slug]/files?kind=…`, `POST .../files/delete`, `POST .../files/rename`
- `GET/POST /api/podcasts/[slug]/storage`, `POST .../storage/test`
- `GET/POST /api/podcasts/[slug]/github`, `POST .../github/test`, `POST .../github/trigger` — GitHub `repository_dispatch` integration

RSS feed lives at `server/routes/feeds/[slug].xml.ts` → `GET /feeds/[slug].xml`. Returns 404 when the podcast is soft-deleted (`status='inactive'`).

### Database

SQLite via `better-sqlite3` (sync, no async/await). Singleton initialized in `server/db/index.ts`; canonical schema in `server/db/schema.sql` (mirrored inline as `SCHEMA_SQL` in `server/db/index.ts` to dodge file-read issues in Nitro production builds — keep both in sync). Idempotent `ALTER` migrations live in `applyMigrations` in `server/db/index.ts` for backward-compatible additions.

Tables: `users`, `podcasts` (per-tenant config + soft-delete `status` / `deleted_at`, plus webhook config: `webhook_url_encrypted`/`webhook_format`/`webhook_enabled`, plus new-episode templates: `episode_title_template`/`episode_description_template`), `podcast_users` (membership), `api_keys`, `api_key_podcasts` (key scope), `episodes` (per-podcast, with `image_url`/`image_filename` for per-episode artwork, plus Podcasting 2.0 fields: `transcript_path`/`transcript_type`, `chapters_url`, `itunes_title`/`itunes_author`/`itunes_explicit`, `season_name`, `episode_display`, `license_identifier`/`license_url`; status enum is `draft|scheduled|published`), `people` (per-podcast roster: name, photo, href, default role/group, `auto_attach` flag), `episode_people` (many-to-many; `role`/`group` frozen at attach time so historical attribution survives roster edits), `slug_aliases` (permanent record of old podcast slugs; the feed handler matches by alias and emits `<itunes:new-feed-url>`), `audit_log` (per-podcast change history, nullable `user_id` for system events like the scheduled-publish flip), `storage_migrations` (queue + progress for end-to-end storage moves), `downloads`.

Background work: `server/plugins/scheduler.ts` boots an in-process timer that runs `processScheduledFlips()` every 60s, flipping `status='scheduled'` episodes whose `published_at` has arrived. The feed handler also calls `processScheduledFlips(podcast.id)` on every render as a fallback if the timer is dead. `server/plugins/migration-worker.ts` boots a second timer that picks up pending storage migrations, copies files end-to-end (audio + artwork dirs), then rewrites all matching URLs across `episodes` + `podcasts` and swaps `storage_config_encrypted` to the target. Stale `running` migrations from a dead process are reaped to `failed` on startup. Publish side effects (webhook + GitHub repository_dispatch) fan out from `firePublishEvent()` in `server/utils/publish-event.ts`.

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
