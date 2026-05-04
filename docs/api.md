# Podshelf API

Podshelf is multi-tenant: every endpoint that touches podcast or episode data is
scoped to a specific podcast slug. The same API key can hit any podcast its
owning user has access to.

Base URL: whatever you've set as `SITE_URL` (defaults to `http://localhost:3000`
in dev).

## Authentication

All mutation endpoints — and most read endpoints — require authentication via
one of:

- **API key (recommended for automation):** `X-Api-Key: <key>` header, or
  `Authorization: Bearer <key>`. Mint keys at `/api-keys`. Each key
  belongs to a user and inherits that user's podcast access.
- **Session cookie:** `session`, set by `POST /api/auth/login`. Used by
  the admin UI; you don't need this for scripts.

API keys can have an expiration and can be disabled. Disabled or expired keys
are rejected as if they didn't exist.

API keys can also be **scoped to a subset of podcasts**. A scoped key can only
hit `/api/podcasts/<allowed-slug>/...` endpoints — other podcasts return 403,
and admin-only cross-podcast endpoints (creating podcasts, managing users)
also return 403 even if the underlying user is an admin. `GET /api/podcasts`
filters its result down to the scoped set. This lets you mint a "Claude" key
that can only touch one show without giving it the keys to your kingdom.

API keys also have a **permission level** that gates HTTP methods:

| Permission | Allowed methods                |
|------------|--------------------------------|
| `full`     | GET, POST, PATCH, PUT, DELETE  |
| `write`    | GET, POST, PATCH, PUT          |
| `read`     | GET, HEAD, OPTIONS only        |

Default is `full`. Combine with podcast scope for tighter permissions — e.g.
a read-only key scoped to one podcast for a read-only dashboard, or a write
key that can publish but not delete episodes. Session-cookie auth (the admin
UI) always has full access.

## Conventions

- Bodies are `application/json` for everything except `/upload` (multipart form).
- Successful mutations return the resulting object. `DELETE` returns 204 with no
  body.
- Errors return `{ "statusCode": 4xx, "statusMessage": "human-readable reason" }`.
- Slugs are lowercase, hyphenated, and unique per podcast (episode slugs are
  scoped to their podcast — different podcasts can have an episode with the same
  slug).

---

## Identity

### `GET /api/me`

Who am I?

```json
{ "id": 1, "email": "you@example.com", "is_admin": true }
```

---

## Podcasts

### `GET /api/podcasts`

Lists podcasts the authenticated user can access. Admins see all; non-admins see
only podcasts they're a member of. Soft-deleted (inactive) podcasts are
included so owners can restore them — check `status`.

```json
[
  {
    "id": 1,
    "slug": "yousaid100miles",
    "title": "You Said 100 Miles?",
    "description": "...",
    "image_url": "https://...",
    "website": "https://yousaid100miles.com",
    "status": "active",
    "deleted_at": null,
    "created_at": "2026-05-01T12:00:00.000Z",
    "updated_at": "2026-05-01T12:00:00.000Z"
  }
]
```

### `GET /api/podcasts/[slug]`

Returns the full podcast metadata (everything except encrypted secrets),
including `status` and `deleted_at`. Membership required.

### `POST /api/podcasts` *(admin only)*

Create a new podcast.

```json
{
  "title": "My New Show",
  "slug": "my-new-show",
  "description": "...",
  "author": "Your Name",
  "email": "you@example.com",
  "website": "https://myshow.example.com"
}
```

### `PATCH /api/podcasts/[slug]`

Update podcast metadata. Send only the fields you want to change. Editable
fields: `slug`, `title`, `description`, `author`, `email`, `image_url`,
`language`, `copyright`, `category`, `explicit`, `website`,
`audio_tracking_prefix`, `itunes_type`, `podcast_locked`, `itunes_complete`,
`itunes_block`, `funding_url`, `funding_label`, `verify_txt`,
`license_identifier`, `license_url`, `episode_title_template`,
`episode_description_template`, `storage_adapter`, `github_owner`,
`github_repo`, `github_event_type`.

### `DELETE /api/podcasts/[slug]`

**Soft-delete** — marks the podcast `status = 'inactive'` and stamps
`deleted_at`. The public RSS feed at `/feeds/<slug>.xml` returns 404 while
inactive, but the podcast stays visible to its members in the admin UI and
all other admin endpoints continue to work so you can restore it. Cascading
purge requires the separate purge endpoint below.

Allowed for any podcast member (owner or admin). Returns 204.

### `POST /api/podcasts/[slug]/restore`

Reverses a soft-delete: sets `status = 'active'` and clears `deleted_at`.
Allowed for any podcast member. Returns `{ ok: true }` (or
`{ ok: true, alreadyActive: true }` for a no-op).

### `DELETE /api/podcasts/[slug]/purge` *(admin only)*

**Permanent delete** — removes the podcast row and cascades to episodes,
downloads, memberships, and api-key scopes. Refuses with 409 unless the
podcast is already soft-deleted (`status = 'inactive'`), so the standard
flow is `DELETE` → review → `DELETE …/purge`. Returns 204.

### `GET /api/admin/inactive-podcasts` *(admin only)*

Lists every soft-deleted podcast across the platform, ordered by `deleted_at`
DESC. Used by the admin "Inactive Podcasts" page.

### `GET /api/podcasts/[slug]/audit?limit=50&before=<id>`

Paginated audit log for the podcast, newest first. `before` is the lowest id
from the previous page; `limit` defaults to 50 (max 200). Visible to all
podcast members. Response: `{ entries: [...], has_more: bool, next_before: id|null }`.
Each entry has `action`, `summary`, `user_email`, `created_at`, and a parsed
`details` object — for setting/episode updates this includes `changed[]`,
`before`, and `after`.

### `GET /api/podcasts/[slug]/webhook`

Returns the redacted webhook config: `{ has_url, format, enabled, url_host }`.
URL itself is never returned (it's encrypted at rest and may include a token
in the path).

### `POST /api/podcasts/[slug]/webhook`

Body: `{ url?, format, enabled }`. `format` is `discord` / `slack` / `generic`.
Omitting `url` preserves the existing one; sending an empty string clears it.
Saves encrypted at rest.

### `POST /api/podcasts/[slug]/webhook/test`

Fires a synthetic test episode through the configured webhook. 502s with the
upstream error if delivery fails.

---

## Episodes

All episode endpoints are scoped under a podcast slug.

### `GET /api/podcasts/[slug]/episodes`

Lists episodes. Optional query params:

| Param  | Description                                                       |
|--------|-------------------------------------------------------------------|
| status | `draft`, `published`, or `scheduled`                              |
| slug   | Fetch a single episode by its (per-podcast) slug                  |

```bash
# All episodes
curl -H "X-Api-Key: $KEY" "$SITE/api/podcasts/yousaid100miles/episodes"

# Only drafts (typical AI handoff polling)
curl -H "X-Api-Key: $KEY" "$SITE/api/podcasts/yousaid100miles/episodes?status=draft"

# Single episode by slug
curl -H "X-Api-Key: $KEY" "$SITE/api/podcasts/yousaid100miles/episodes?slug=ep-42"
```

### `POST /api/podcasts/[slug]/episodes`

Create an episode. Required: `title`. Recommended: `audio_url` (or upload
first — see `/upload` below). Optional fields are filled with sensible
defaults.

```json
{
  "title": "Ep 42: Trail running on the Continental Divide",
  "description": "<p>HTML show notes.</p>",
  "audio_url": "https://media.example.com/ep42.mp3",
  "audio_size_bytes": 67188837,
  "audio_duration_seconds": 3600,
  "image_url": "https://media.example.com/artwork/ep42.jpg",
  "image_filename": "ep42.jpg",
  "episode_number": 42,
  "season_number": 2,
  "tags": "running, ultramarathon",
  "status": "draft",
  "published_at": null
}
```

`status` defaults to `"draft"`. Setting `status: "published"` requires
`published_at` (or it'll be null and the episode won't appear in the RSS feed).
If `status: "published"` is paired with a `published_at` in the future, the
server stores the episode as `"scheduled"` and an in-process scheduler flips
it to `"published"` (firing the webhook + GitHub trigger) when the time hits.

`image_url` is optional per-episode artwork — when set, it's emitted as
`<itunes:image>` at the item level in the RSS feed. Episodes without one
inherit the channel-level podcast artwork. `image_filename` is the basename
on disk (used by the file browser to detect references).

If `slug` is omitted it's auto-derived from `title` with collision handling.

Additional Podcasting 2.0 fields accepted on create / update:

| Field                | Description                                                                                |
|----------------------|--------------------------------------------------------------------------------------------|
| `episode_type`       | `full` (default), `trailer`, or `bonus`. Emitted as `<itunes:episodeType>`.                |
| `transcript_path`    | URL of the transcript file. Emitted as `<podcast:transcript url>`.                         |
| `transcript_type`    | MIME type. One of `text/html`, `text/plain`, `application/srt`, `text/vtt`, `application/json`. Auto-detected from URL extension when blank. |
| `chapters_url`       | URL of a Podcasting 2.0 chapters JSON file. Set indirectly via the chapters endpoint.      |
| `itunes_title`       | "Clean" episode title without season/number prefixes. Emitted as `<itunes:title>`.         |
| `itunes_author`      | Per-episode author override. Emitted as `<itunes:author>`.                                 |
| `itunes_explicit`    | `'true'` or `'false'`. Overrides the channel default for this single episode.              |
| `season_name`        | Display name for `<podcast:season name="…">` (e.g. `"Series 1"`).                          |
| `episode_display`    | Display string for `<podcast:episode display="…">` (e.g. `"S2E22"`).                       |
| `license_identifier` | SPDX or custom license name (e.g. `CC-BY-4.0`). Per-episode license override.              |
| `license_url`        | URL to the license terms.                                                                  |

### `POST /api/podcasts/[slug]/episodes/[id]/chapters`

Body: `{ "text": "MM:SS Title\n…" }`. Parses a textarea-style chapters list,
serializes it to a Podcasting 2.0 chapters JSON file, uploads the file to the
podcast's audio storage directory next to the MP3, and persists the public URL
on the episode row. Each line is `MM:SS Title` or `HH:MM:SS Title`, with an
optional ` | url` suffix. Sending an empty `text` clears the chapters URL.

```bash
curl -X POST -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"text":"00:00 Intro\n05:30 Topic one | https://example.com/topic-one"}' \
  "$SITE/api/podcasts/yousaid100miles/episodes/127/chapters"
```

Response: `{ "chapters_url": "https://…", "count": 2 }`.

### People

Per-podcast roster + per-episode attachments for `<podcast:person>` tags.

| Endpoint                                                                  | Purpose                                                                |
|---------------------------------------------------------------------------|------------------------------------------------------------------------|
| `GET /api/podcasts/[slug]/people`                                         | List the podcast's roster.                                             |
| `POST /api/podcasts/[slug]/people`                                        | Add a person. Body: `{ name, img_url?, href?, default_role?, default_group?, auto_attach? }`. |
| `PATCH /api/podcasts/[slug]/people/[id]`                                  | Update a roster record. Does not rewrite past `episode_people` rows.   |
| `DELETE /api/podcasts/[slug]/people/[id]`                                 | Remove from the roster (cascades to attachments).                      |
| `GET /api/podcasts/[slug]/episodes/[id]/people`                           | List people attached to an episode.                                    |
| `POST /api/podcasts/[slug]/episodes/[id]/people`                          | Attach. Body: `{ person_id, role?, group? }` — defaults from the person's record. |
| `DELETE /api/podcasts/[slug]/episodes/[id]/people/[attachId]`             | Detach a single attachment.                                            |

`role` and `group` on an `episode_people` attachment are captured at attach
time and **not** updated when the underlying person's defaults change — so
retiring or renaming a host doesn't rewrite past episodes' attribution.
Setting `auto_attach=true` on a person opts them into automatic attachment
on every newly-created episode.

### `PATCH /api/podcasts/[slug]/episodes/[id]`

Update any field on an existing episode. Same fields as create.

```bash
# Fix the episode number
curl -X PATCH -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"episode_number": 43}' \
  "$SITE/api/podcasts/yousaid100miles/episodes/127"

# Approve a draft → push live
curl -X PATCH -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"status": "published", "published_at": "2026-05-01T14:00:00.000Z"}' \
  "$SITE/api/podcasts/yousaid100miles/episodes/127"
```

### `DELETE /api/podcasts/[slug]/episodes/[id]`

Permanently deletes the episode and its download history. Returns 204.

### `POST /api/podcasts/[slug]/episodes/[id]/duplicate`

Clone an episode into a new draft. Carries over description, tags,
image_url + filename, season_number, season_name, episode_type,
itunes_title/author, license override, and people attachments (with their
role/group frozen at duplicate time). Clears audio file, chapters URL,
transcript path/type, episode_number, episode_display, published_at, and
GUID. Title becomes "Original (Copy)", slug becomes `original-slug-copy`
with collision handling. Returns 201 + the new episode row.

### `GET /api/podcasts/[slug]/episodes/template`

Returns the rendered episode templates and suggested numbers for the
"+ New Episode" form to pre-fill:

```json
{
  "title": "S2E22: ",
  "description": "<p>Standard footer goes here…</p>",
  "season_number": 2,
  "episode_number": 22
}
```

Placeholders supported in `episode_title_template` and
`episode_description_template`: `{season}`, `{episode}`, `{date}` (today
as `YYYY-MM-DD`). Suggested season = the season of the most recently-
created episode (null when no episodes exist or the latest had no
season). Suggested episode = `max(episode_number) + 1` scoped to the
suggested season, or globally when no season is set.

---

## Uploads

### `POST /api/podcasts/[slug]/upload?kind=audio|artwork|transcript|chapters`

Multipart upload. Field: `file`. Routed through whichever storage adapter is
configured for the podcast (set up in the admin UI under the **Storage** tab,
with credentials encrypted at rest).

| `kind`    | Allowed MIME types                                                       | Max size | Target dir |
|-----------|--------------------------------------------------------------------------|----------|------------|
| `audio` (default) | mpeg/mp3/mp4/m4a/aac/ogg/wav/flac                                | 500 MB   | audio dir / bucket root |
| `artwork` | `image/jpeg`, `image/png`, `image/webp`                                  | 25 MB    | artwork dir or `artworkPrefix` |
| `transcript` | text/html, text/plain, text/vtt, application/srt, application/json (or `.html` / `.txt` / `.srt` / `.vtt` / `.json` extension) | 10 MB | audio dir (sidecar to MP3) |
| `chapters`   | application/json (or `.json` extension) — Podcasting 2.0 chapters JSON   | 2 MB     | audio dir (sidecar to MP3) |

For `kind=artwork`, the podcast's storage must have artwork settings
configured (SFTP `artworkRemoteDir` + `artworkPublicUrlBase`, or S3
`artworkPrefix` and/or `artworkPublicUrlBase`) — otherwise the request 400s
with a hint.

```bash
# Audio (default)
curl -X POST -H "X-Api-Key: $KEY" \
  -F "file=@/path/to/episode.mp3" \
  "$SITE/api/podcasts/yousaid100miles/upload"

# Artwork
curl -X POST -H "X-Api-Key: $KEY" \
  -F "file=@/path/to/cover.jpg" \
  "$SITE/api/podcasts/yousaid100miles/upload?kind=artwork"
```

Response:

```json
{
  "url": "https://yourhost.example.com/podcast/audio/episode.mp3",
  "filename": "episode.mp3",
  "size": 67188837,
  "content_type": "audio/mpeg",
  "kind": "audio"
}
```

For `audio` uploads, take `url` and `size` and pass them to the episode-create
endpoint as `audio_url` and `audio_size_bytes`. For `artwork` uploads, pass
`url` and `filename` as `image_url` and `image_filename`. For `transcript`
uploads, pass `url` (and optionally `content_type`) as `transcript_path` and
`transcript_type`. For `chapters` uploads, pass `url` as `chapters_url`.

### `GET /api/audio-probe?url=<encoded-url>`

Server-side HEAD request against an external audio URL. Returns the
Content-Length and Content-Type so you can fill in size without downloading the
file. Useful when you've already uploaded somewhere else and just need the
metadata.

---

## Files (file browser)

These endpoints list and manage files in the podcast's audio or artwork
directory. Used by the admin **Files** page.

### `GET /api/podcasts/[slug]/files?kind=audio|artwork`

Lists every file in the chosen directory along with its public URL, size,
modification time, and an `inUse` flag indicating whether it's referenced by
an episode (audio: `audio_filename` / `audio_url`; artwork: `image_filename`
/ `image_url`) or, for artwork, by the podcast's main `image_url`.

```json
{
  "kind": "audio",
  "publicUrlBase": "https://example.com/podcast/audio",
  "files": [
    {
      "name": "ep42.mp3",
      "size": 67188837,
      "modifiedAt": "2026-05-01T12:00:00.000Z",
      "url": "https://example.com/podcast/audio/ep42.mp3",
      "inUse": true,
      "usedBy": ["Episode #127: Ep 42: Trail running on the Continental Divide"]
    }
  ]
}
```

### `POST /api/podcasts/[slug]/files/delete`

Body: `{ kind, name, force? }`. Deletes the file from the directory. Without
`force: true`, the request 409s when the file is referenced — the response
`data.usedBy` lists the references so you can warn before retrying with
`force: true`.

### `POST /api/podcasts/[slug]/files/rename`

Body: `{ kind, fromName, toName, updateReferences? }`. Renames a file in
place. When `updateReferences: true`, also rewrites every episode row that
references the old filename (and the podcast `image_url` for artwork) to
point at the new URL/filename. Returns `{ ok, url, name, updatedEpisodes,
updatedPodcast }`.

`toName` must use only `[A-Za-z0-9._-]`; otherwise the request 400s (the
upload endpoint applies the same sanitisation, so reusing the rule keeps
file names round-trippable).

---

## API keys (for the current user)

### `GET /api/me/api-keys`

Lists your own keys (no plaintext — that's only returned at creation).

### `POST /api/me/api-keys`

Mints a new key. Body:

```json
{
  "label": "Claude",
  "expires_at": "2027-01-01T00:00:00Z",
  "permissions": "write",
  "podcast_slugs": ["yousaid100miles"]
}
```

`expires_at`, `permissions`, and `podcast_slugs` are optional.
`permissions` defaults to `full`; valid values are `read`, `write`, `full`.
Omitting `podcast_slugs` (or sending `null`) creates an unrestricted key
that inherits all of the user's podcast access. The user must already have
access to every podcast they're scoping a key to.

**Response includes the plaintext `key` exactly once — grab it now**; only
its sha256 hash is stored.

### `PATCH /api/me/api-keys/[id]`

Toggle `disabled`, change `label`, change `expires_at` (set to `null` to
remove expiration), change `permissions`, or change `podcast_slugs` to
update scope.

`podcast_slugs` semantics on PATCH:
- field absent → don't change scope
- `null` or `[]` → make the key unrestricted
- non-empty array → replace scope with these slugs

### `DELETE /api/me/api-keys/[id]`

Permanently revokes the key.

---

## AI handoff workflow

Typical end-to-end for an AI agent (Claude, OpenClaw, etc.):

```bash
SITE=https://podshelf.example.com
KEY=pk_xxxxxxxxxxxx
SLUG=yousaid100miles

# 1. Upload audio
UP=$(curl -s -X POST -H "X-Api-Key: $KEY" \
  -F "file=@/path/to/ep.mp3" \
  "$SITE/api/podcasts/$SLUG/upload")
URL=$(echo "$UP" | jq -r '.url')
SIZE=$(echo "$UP" | jq -r '.size')

# 2. Create draft episode
curl -s -X POST -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \
  -d "$(jq -n --arg url "$URL" --argjson size $SIZE '{
    title: "Ep 50: Some good title",
    description: "<p>Show notes go here.</p>",
    audio_url: $url,
    audio_size_bytes: $size,
    episode_number: 50,
    status: "draft"
  }')" \
  "$SITE/api/podcasts/$SLUG/episodes"
```

The user reviews drafts in the admin UI, tweaks if needed, then either clicks
**Save & Publish** (which sets `status=published` + `published_at=now`) or
flips the status via API.

The `scripts/podshelf-publish.sh` wrapper does both steps in one shot:

```bash
PODSHELF_API_KEY=pk_… ./scripts/podshelf-publish.sh \
  --podcast yousaid100miles \
  --file ./ep50.mp3 \
  --title "Ep 50: Some good title" \
  --description "<p>Show notes</p>" \
  --episode-number 50
```

---

## Settings, storage, members

These exist but are mostly used by the admin UI:

- `POST /api/podcasts/[slug]/storage` — save encrypted SFTP/S3 credentials.
  Body shape: `{ adapter: 'sftp'|'s3', config: <SftpConfig|S3Config> }`. The
  config object can include optional artwork fields:
  - SFTP: `artworkRemoteDir`, `artworkPublicUrlBase` (required together).
  - S3: `artworkPrefix` (e.g. `"artwork/"`), `artworkPublicUrlBase` (falls
    back to `publicUrlBase` if blank).
- `POST /api/podcasts/[slug]/storage/test` — connection test. Body
  `{ adapter, config, kind?: 'audio'|'artwork' }`; `kind` controls which
  directory/prefix is listed (defaults to `audio`).
- `GET /api/podcasts/[slug]/stats` — download counts (when GeoIP DB is configured)
- `GET/POST/DELETE /api/podcasts/[slug]/members/...` — admin grants user access

See the source for full schemas — they're not the typical handoff path.

---

## Build & deploy (GitHub `repository_dispatch`)

When configured, Podshelf can fire a `repository_dispatch` event to GitHub
whenever the published feed changes — your Actions workflow listens for it
and runs the static-site rebuild + deploy.

### `GET /api/podcasts/[slug]/github`

Returns redacted config (no token):

```json
{
  "configured": true,
  "owner": "bhenne22",
  "repo": "yousaid100miles.com",
  "event_type": "podshelf-feed-update",
  "has_token": true,
  "auto_trigger": true
}
```

### `POST /api/podcasts/[slug]/github`

Save the config. Body:

```json
{
  "owner": "bhenne22",
  "repo": "yousaid100miles.com",
  "event_type": "podshelf-feed-update",
  "token": "ghp_… or fine-grained token",
  "auto_trigger": true
}
```

`token` is optional on update — leave it blank/omit to keep the existing
encrypted token in place.

### `POST /api/podcasts/[slug]/github/test`

Sends a single dispatch right now to verify credentials. Body fields are
optional and override the saved config; secrets fall back to the saved
encrypted token when omitted.

### `POST /api/podcasts/[slug]/github/trigger`

Manual rebuild — fires using the saved config. Returns `{ ok: true, status }`
on success, where `status` is GitHub's HTTP status code (typically 204).

### Auto-trigger semantics

When `auto_trigger` is on, Podshelf fires automatically after:

- Episode created with `status=published`
- Episode updated where the previous OR new state was published
- Episode deleted that was published
- Podcast settings updated for any feed-visible field (title, description,
  author, image, language, copyright, category, explicit, website,
  audio_tracking_prefix)
- RSS import that imported at least one item

Drafts and storage/GitHub config edits never fire — only changes that
actually affect the published RSS feed.

### Workflow snippet

In your static-site repo:

```yaml
on:
  repository_dispatch:
    types: [podshelf-feed-update]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run generate
      # … then SFTP / wherever your deploy goes
```

The `client_payload` Podshelf sends includes `{ reason, podcast_id, fired_at }`
if your workflow wants to know what kicked the build.

---

## RSS feeds

Each podcast has its own feed:

```
GET /feeds/[slug].xml
```

This is what you point Apple Podcasts, Spotify, etc. at. Listeners never hit
Podshelf for audio — the feed contains the original `audio_url` (or the
configured tracking-prefix-wrapped version), which points directly at SFTP/S3.

Episodes with `image_url` set emit `<itunes:image href="…">` at the item
level; episodes without inherit the channel-level podcast artwork.

The feed returns **404 when the podcast is soft-deleted**
(`status = 'inactive'`). Restore the podcast (`POST .../restore`) to bring
the feed back online.

If `audio_tracking_prefix` is set to `<SITE_URL>/track/`, episode downloads
hit Podshelf's `/track/<audio-url>` redirect endpoint, which logs the
download (deduped by IP + 24h per IAB recommendations) and 302s the listener
to the real audio URL. Bandwidth stays on your storage host.

---

## RSS import (for migrations)

### `POST /api/podcasts/[slug]/import-rss`

One-shot import for transferring an existing show onto Podshelf. Refuses to
run if any episodes already exist.

```bash
curl -X POST -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"feed_url": "https://feeds.example.com/oldhost/yourshow.xml"}' \
  "$SITE/api/podcasts/yousaid100miles/import-rss"
```

Response: `{ feed_title, total_items, imported, skipped }`. Items without an
`<enclosure>` are skipped. Audio URLs are kept as-is — point them at your new
host afterward by editing each episode if you've moved files.
