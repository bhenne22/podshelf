# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Podshelf is a self-hosted, **multi-tenant** podcast publishing platform. One installation hosts many podcasts; each podcast has its own settings, storage credentials, episodes, members, and RSS feed. The database is embedded SQLite (`better-sqlite3`, synchronous API). The platform is headless by default — it produces an iTunes-compatible RSS feed (and optionally fires GitHub `repository_dispatch` events to rebuild a static site) but doesn't itself serve a public listener-facing website.

For how Podshelf relates to its downstream Nuxt static sites
(`teampumaknife.com`, `yousaid100miles.com`, `yourewatchingitwrong.com`), see
[`docs/architecture.md`](./docs/architecture.md) — that doc covers the dispatch
chain, hosting layout, and the contracts that must not break.

## Commands

```bash
npm run dev        # Development server
npm run build      # Production build
npm run preview    # Preview production build
npm run typecheck  # TypeScript type checking (requires `nuxi prepare` first)
npm test           # node:test runner via tsx; tests live in test/*.test.ts
```

Tests are intentionally narrow — pure-function coverage on parsers and
projection-shape pinning on a few endpoints. No e2e or DB integration tests.

## Architecture

### Full-Stack Nuxt 3

Nuxt handles both frontend (Vue 3, file-based routing in `pages/`) and backend (Nitro/h3 server, API routes in `server/api/`). There is no separate backend process.

### Pages & Routing

`/admin/*` is reserved for true platform-admin functionality. Everything regular podcast members touch lives outside `/admin/`.

User-facing routes (login required):
- `/login` — password login
- `/` — list of podcasts the user can access (the dashboard)
- `/api-keys` — per-user API key management
- `/docs` — interactive API reference (Swagger UI loading `public/openapi.yaml`)
- `/podcasts/[slug]` — per-podcast dashboard
- `/podcasts/[slug]/episodes` — episode list (with season + date-range filters and Overall # / Season # / Ep # columns)
- `/podcasts/[slug]/episodes/new`, `/podcasts/[slug]/episodes/[id]` — episode CRUD (transcript + chapters file/textarea, per-episode RSS overrides, people attachments)
- `/podcasts/[slug]/people` — per-podcast roster of hosts/guests (powers `<podcast:person>` tags in the feed)
- `/podcasts/[slug]/settings` — podcast metadata (paste-URL or upload artwork; soft-delete in Danger Zone)
- `/podcasts/[slug]/storage` — per-podcast SFTP / S3 credentials, plus separate audio + artwork directories
- `/podcasts/[slug]/files` — file browser for the audio + artwork directories (list, upload, rename, delete, copy URL, in-use warning)
- `/podcasts/[slug]/distribution` — "Listen on" destinations list (Apple, Spotify, etc.); admin-only metadata, exposed via API for static-site builds, **not** in the RSS feed
- `/podcasts/[slug]/corrections` — triage queue for listener-reported factual errors submitted through the downstream sites' correction forms; filter by status, add a resolution note, record which episode we owned up on
- `/podcasts/[slug]/preview`, `/podcasts/[slug]/preview/[id]` — Apple-style preview of the show (artwork, metadata, episode cards with inline `<audio>` + collapsible chapters/transcript/notes panels) and a per-episode detail view (bigger player, prev/next nav). Both pages have a Desktop/Mobile view toggle that wraps the content in a phone-style frame and uses CSS container queries for the responsive layout. Drafts + scheduled included. Admin-only, no public surface.
- `/podcasts/[slug]/build`, `/podcasts/[slug]/stats`, `/podcasts/[slug]/members`, `/podcasts/[slug]/import-rss` — build dispatch, analytics, membership, RSS import
- `/podcasts/[slug]/audit` — chronological audit log of every change (visible to all members)
- `/networks`, `/networks/[slug]` — networks the user belongs to and a per-network dashboard (roster + 14d-back-to-N-day-forward timeline of recently published + upcoming episodes across siblings). Visibility is implicit: any user in any podcast in a network can read that network. Admins always see the `/networks` link.

Admin-only routes (`is_admin` required):
- `/admin/users` — user management
- `/admin/podcasts/new` — create a new podcast
- `/admin/inactive-podcasts` — purge / restore soft-deleted podcasts
- `/admin/networks`, `/admin/networks/[id]` — manage networks (metadata, roster reorder, custom property schema + per-podcast values)

Two route middlewares enforce these:
- `middleware/auth.ts` — login required (used by all user-facing pages above)
- `middleware/admin-only.ts` — login + `is_admin` required (used by `/admin/*` pages); non-admins bounce to `/`, unauthenticated callers bounce to `/login`

API endpoints are protected server-side by `requireAuth` / `requirePodcastAccess` / `requireNetworkReadAccess` / `requireAdmin` from `server/utils/auth.ts`, accepting either:
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
- `GET/POST/PATCH/DELETE /api/podcasts/[slug]/distribution` (+ `[id]`), `POST .../distribution/reorder` — "Listen on" destination list (name, url, platform_id, notes); not surfaced in feed but exposed for static-site builds
- `POST /api/public/corrections` (+ `OPTIONS`) — **the only unauthenticated write endpoint.** Listener-submitted factual corrections from the downstream static sites, which are prerendered and have no server to receive their own form posts. Gated by a honeypot field, length caps, an http(s)-only check on `source_url`, and 5 submissions per IP hash per hour. CORS origins are derived from the `podcasts.website` column of active podcasts — deliberately **not** a separate env allowlist, so a new sister site works as soon as its podcast record has a website. Fires the `correction.submitted` webhook event.
- `GET /api/podcasts/[slug]/corrections`, `PATCH .../corrections/[id]` — member-only triage (`status` ∈ `new|confirmed|rejected|aired`, `resolution_note`, `aired_episode_id`). Submitted content is immutable; `ip_hash`/`user_agent` are never projected.
- `GET/POST/DELETE /api/podcasts/[slug]/episodes/[id]/people` (+ `/[attachId]`) — per-episode attachments; `role`/`group` frozen at attach time
- `POST /api/podcasts/[slug]/episodes/[id]/duplicate` — clone an episode into a fresh draft, carries description/tags/image/season/etc + people attachments, clears audio/chapters/transcript/numbers/dates
- `GET /api/podcasts/[slug]/episodes/template` — returns rendered title/description templates + suggested next season/episode numbers for the New Episode form to pre-fill
- `GET /api/podcasts/[slug]/aliases` — list of old slugs that still serve the feed
- `GET /api/podcasts/[slug]/export.json`, `POST .../import-json` — full Podshelf-archive JSON export / import (settings, episodes incl drafts/scheduled, people, aliases; excludes secrets/members)
- `POST /api/podcasts/[slug]/storage/migrate`, `GET .../storage/migrate` — queue and monitor end-to-end storage migration (file copy + URL rewrite + config swap)
- `POST /api/podcasts/[slug]/upload?kind=audio|artwork|transcript|chapters` — multipart upload (audio: 500 MB, image: 25 MB, transcript: 10 MB, chapters JSON: 2 MB; transcripts + chapters land in the audio directory as sidecar files)
- `GET /api/podcasts/[slug]/audit?limit=50&before=<id>` — paginated per-podcast audit log
- `GET/POST /api/podcasts/[slug]/webhooks`, `GET/PATCH/DELETE .../webhooks/[id]`, `POST .../webhooks/[id]/test` — per-podcast webhook CRUD with per-row event subscription (`episode.publish`, `episode.recording.scheduled|moved|cancelled`, `correction.submitted`); URL encrypted at rest, format selector for discord/slack/generic. Network-scoped mirror lives under `/api/admin/networks/[id]/webhooks/...` (admin-only) and fans out across every podcast in the network.
- `GET /api/podcasts/[slug]/files?kind=…`, `POST .../files/delete`, `POST .../files/rename`
- `GET/POST /api/podcasts/[slug]/storage`, `POST .../storage/test`
- `GET/POST /api/podcasts/[slug]/github`, `POST .../github/test`, `POST .../github/trigger` — GitHub `repository_dispatch` integration
- `POST /api/podcasts/[slug]/deploys-paused` (admin-only) — kill switch for all `repository_dispatch` paths (auto, manual, test, and the scheduled-flip publisher); dirty markers still accumulate so unpause fires a normal debounced build
- `GET /api/networks` (with optional `?podcastSlug=` filter), `GET /api/networks/[slug]` (with optional `?include=properties`), `GET /api/networks/[slug]/upcoming-episodes`, `GET /api/networks/[slug]/property-definitions`, `GET /api/networks/[slug]/properties` — read surface for networks. Implicit membership via `podcast_users`; scoped API keys see only values for podcasts inside their scope.
- Admin CRUD: `/api/admin/networks` (+ `[id]`, `[id]/podcasts`, `[id]/podcasts/[podcast_id]`) and `/api/admin/networks/[id]/property-definitions` (+ `[key]`, `[id]/podcasts/[podcast_id]/properties/[key]`)

RSS feed lives at `server/routes/feeds/[slug].xml.ts` → `GET /feeds/[slug].xml`. Returns 404 when the podcast is soft-deleted (`status='inactive'`).

### Database

SQLite via `better-sqlite3` (sync, no async/await). Singleton initialized in `server/db/index.ts`; canonical schema in `server/db/schema.sql` (mirrored inline as `SCHEMA_SQL` in `server/db/index.ts` to dodge file-read issues in Nitro production builds — keep both in sync). Idempotent `ALTER` migrations live in `applyMigrations` in `server/db/index.ts` for backward-compatible additions.

Tables: `users`, `podcasts` (per-tenant config + soft-delete `status` / `deleted_at`, plus new-episode templates: `episode_title_template`/`episode_description_template`, plus `deploys_paused` kill switch), `podcast_users` (membership), `api_keys`, `api_key_podcasts` (key scope), `episodes` (per-podcast, with `image_url`/`image_filename` for per-episode artwork, plus Podcasting 2.0 fields: `transcript_path`/`transcript_type`, `chapters_url`, `itunes_title`/`itunes_author`/`itunes_explicit`, `season_name`, `episode_display`, `license_identifier`/`license_url`; status enum is `draft|scheduled|published`), `people` (per-podcast roster: name, photo, href, default role/group, `auto_attach` flag), `episode_people` (many-to-many; `role`/`group` frozen at attach time so historical attribution survives roster edits), `slug_aliases` (permanent record of old podcast slugs; the feed handler matches by alias and emits `<itunes:new-feed-url>`), `podcast_distributions` (per-podcast "Listen on" destinations: name, url, platform_id, notes, position; admin-only metadata, not in feed), `networks` (named groupings of sibling podcasts) + `network_podcasts` (compound-PK join with `position`, allows a podcast in multiple networks), `network_property_definitions` (per-network schema of custom fields: key, label, type ∈ {string|boolean|number|url|color}, required, position) + `network_podcast_properties` (per-(network, podcast) values; FK against `network_podcasts` compound PK so leaving a network auto-clears values), `audit_log` (per-podcast change history, nullable `user_id` for system events like the scheduled-publish flip), `storage_migrations` (queue + progress for end-to-end storage moves), `downloads`, `webhooks` (per-tenant publish + recording webhooks; XOR-scoped to either a podcast or a network via CHECK constraint; `events` is a JSON array of subscribed event names), `corrections` (listener-submitted factual errors; `episode_slug` is stored alongside the nullable `episode_id` FK so a submission still says which episode it meant after an episode delete; `ip_hash` for rate limiting only).

Background work: `server/plugins/scheduler.ts` boots an in-process timer that runs `processScheduledFlips()` every 60s, flipping `status='scheduled'` episodes whose `published_at` has arrived. The feed handler also calls `processScheduledFlips(podcast.id)` on every render as a fallback if the timer is dead. `server/plugins/migration-worker.ts` boots a second timer that picks up pending storage migrations, copies files end-to-end (audio + artwork dirs), then rewrites all matching URLs across `episodes` + `podcasts` and swaps `storage_config_encrypted` to the target. Stale `running` migrations from a dead process are reaped to `failed` on startup. Publish side effects (webhooks + GitHub repository_dispatch) fan out from `firePublishEvent()` in `server/utils/publish-event.ts`; recording-change events go through `fireRecordingEvent()` in `server/utils/recording-event.ts`; listener corrections go through `fireCorrectionEvent()` in `server/utils/correction-event.ts`. All three call `loadWebhooksForEvent(podcastId, event)` which returns every enabled, subscribed webhook from the podcast itself + any networks it belongs to. Correction payloads are the only ones built from untrusted input — `buildCorrectionBody()` escapes markdown and defuses `@everyone`/`@here` before anything reaches a Discord channel. The event-name + format lists are the single source of truth in `utils/webhook-events.ts` (root `utils/`, so both the Nitro server and the Vue app import it — `server/utils/webhook.ts` re-exports it); the webhook UI's `EVENT_LABELS` is typed `Record<WebhookEvent, string>`, so adding an event without a UI label fails the typecheck rather than silently shipping a webhook the UI can't subscribe to.

### Storage Adapters

`server/storage/sftp.ts` and `server/storage/s3.ts`. Each podcast has its own adapter selection and credentials (encrypted at rest with `PODSHELF_ENCRYPTION_KEY`). Each adapter supports two directories per podcast:

- **audio** (`remoteDir` / `publicUrlBase` for SFTP; bucket root + `publicUrlBase` for S3)
- **artwork** (`artworkRemoteDir` / `artworkPublicUrlBase` for SFTP; `artworkPrefix` + `artworkPublicUrlBase` for S3 — falls back to audio URL base when blank)

Helpers: `resolveSftpTarget`, `resolveS3Target` in `server/utils/storage-config.ts` — pass `'audio' | 'artwork'` to get the appropriate dir + URL base. Upload/list/delete/rename functions all take a `kind` param and route accordingly.

Uploads are **streamed** end-to-end via `server/utils/multipart-stream.ts` (busboy) into either `uploadStreamToSftp` or `uploadStreamToS3` (`@aws-sdk/lib-storage` multipart). The handler never buffers a full file body in memory — a 500 MB audio upload doesn't allocate 500 MB of heap. Size limits are enforced as bytes flow through.

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
