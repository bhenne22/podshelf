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
  `Authorization: Bearer <key>`. Mint keys at `/admin/api-keys`. Each key
  belongs to a user and inherits that user's podcast access.
- **Session cookie:** `admin_session`, set by `POST /api/auth/login`. Used by
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
only podcasts they're a member of.

```json
[
  {
    "id": 1,
    "slug": "yousaid100miles",
    "title": "You Said 100 Miles?",
    "description": "...",
    "image_url": "https://...",
    "website": "https://yousaid100miles.com",
    "created_at": "2026-05-01T12:00:00.000Z",
    "updated_at": "2026-05-01T12:00:00.000Z"
  }
]
```

### `GET /api/podcasts/[slug]`

Returns the full podcast metadata (everything except encrypted secrets).
Membership required.

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
fields: `title`, `description`, `author`, `email`, `image_url`, `language`,
`copyright`, `category`, `explicit`, `website`, `audio_tracking_prefix`,
`storage_adapter`, `github_owner`, `github_repo`, `github_event_type`.

### `DELETE /api/podcasts/[slug]` *(admin only)*

Removes the podcast and cascades to episodes, downloads, and memberships.

---

## Episodes

All episode endpoints are scoped under a podcast slug.

### `GET /api/podcasts/[slug]/episodes`

Lists episodes. Optional query params:

| Param  | Description                                      |
|--------|--------------------------------------------------|
| status | `draft` or `published`                           |
| slug   | Fetch a single episode by its (per-podcast) slug |

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
  "episode_number": 42,
  "season_number": 2,
  "tags": "running, ultramarathon",
  "status": "draft",
  "published_at": null
}
```

`status` defaults to `"draft"`. Setting `status: "published"` requires
`published_at` (or it'll be null and the episode won't appear in the RSS feed).

If `slug` is omitted it's auto-derived from `title` with collision handling.

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

---

## Uploads

### `POST /api/podcasts/[slug]/upload`

Multipart upload. Field: `file`. Must be an audio MIME type. Max 500 MB.
Routed through whichever storage adapter is configured for the podcast (set up
in the admin UI under the **Storage** tab, with credentials encrypted at rest).

```bash
curl -X POST -H "X-Api-Key: $KEY" \
  -F "file=@/path/to/episode.mp3" \
  "$SITE/api/podcasts/yousaid100miles/upload"
```

Response:

```json
{
  "url": "https://yourhost.example.com/podcast/audio/episode.mp3",
  "filename": "episode.mp3",
  "size": 67188837,
  "content_type": "audio/mpeg"
}
```

You take this `url` and `size` and pass them to the episode-create endpoint as
`audio_url` and `audio_size_bytes`.

### `GET /api/audio-probe?url=<encoded-url>`

Server-side HEAD request against an external audio URL. Returns the
Content-Length and Content-Type so you can fill in size without downloading the
file. Useful when you've already uploaded somewhere else and just need the
metadata.

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

- `POST /api/podcasts/[slug]/storage` — save encrypted SFTP/S3 credentials
- `POST /api/podcasts/[slug]/storage/test` — connection test, lists remote dir
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
