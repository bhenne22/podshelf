# Podshelf API

Podshelf is multi-tenant: every endpoint that touches podcast or episode data is
scoped to a specific podcast slug. The same API key can hit any podcast its
owning user has access to.

Base URL: whatever you've set as `SITE_URL` (defaults to `http://localhost:3000`
in dev).

> **Interactive reference:** an OpenAPI 3 spec lives at `public/openapi.yaml`
> and is rendered as Swagger UI at `/docs` on the running instance. The
> "Try it out" button there uses your API key directly against the same
> origin you're viewing the docs on. This Markdown file remains the
> human-readable narrative; the OpenAPI spec is the machine-readable
> reference. Keep both in sync when adding endpoints.

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
{
  "id": 1,
  "email": "you@example.com",
  "is_admin": true,
  "full_name": "Bob Henne",
  "display_name": "Bucket Hat Bob"
}
```

`full_name` / `display_name` may be `null`. Display name is the one to show
in member-list contexts when set; fall back to `full_name` then `email`.

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
    "lifecycle": "active",
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
`github_repo`, `github_event_type`, `lifecycle`, `build_admin_only`.

`lifecycle` is a Podshelf-only publishing lifecycle indicator: `active`,
`inactive`, or `retired`. It's exposed via the API for static-site builds and
shown on the dashboard, but is **not** surfaced in the RSS feed.

`build_admin_only` (default `true`) gates the GitHub-config form to admins
only. The Rebuild Now banner and `/github/trigger` endpoint stay open to all
podcast members regardless. **Only admins can flip this field**; non-admins
get a 403 if they include it in the body.

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

### `GET /api/podcasts/[slug]/webhooks`

Returns the list of webhooks attached to this podcast, redacted. Each row:
`{ id, scope, scope_id, name, format, enabled, events, include_recording_link, url_host, created_at, updated_at }`.
URLs themselves are never returned (they're encrypted at rest and may include
a token in the path).

### `POST /api/podcasts/[slug]/webhooks`

Body: `{ name?, url, format, enabled?, events, include_recording_link? }`. `format` is
`discord` / `slack` / `generic`. `events` is an array selected from:
`episode.publish`, `episode.recording.scheduled`, `episode.recording.moved`,
`episode.recording.cancelled`, `correction.submitted`. Returns the new
redacted webhook row with status 201.

**Format / URL compatibility.** Discord URLs (`discord.com`,
`discordapp.com`, `ptb.discord.com`, `canary.discord.com`) must use
`format='discord'`; Slack URLs (`hooks.slack.com`) must use `format='slack'`.
Other combinations are rejected with 400 at create + update time, because
Discord's API returns 50006 "Cannot send an empty message" and Slack's
returns "no_text" when handed the generic JSON payload.

**Recording-link disclosure.** Recording webhooks can include the episode's
`recording_link` (the Zoom/Riverside room URL) in the delivered message, but
only when the webhook row has `include_recording_link: true`. It defaults to
**false** on create — omitting the field means "withhold" — so a room URL is
never posted to a destination that didn't explicitly ask for it. The gate
applies to all three formats, including `generic`, where `recording_link` is
sent as `null` rather than dropped so the payload shape stays stable.

The same flag decides what the message's "add to calendar" link discloses:
the link is a signed one-off `.ics` (see below) whose token has the flag baked
into its signature, so a link posted in a public channel cannot be edited into
one that reveals the room.

### `PATCH /api/podcasts/[slug]/webhooks/[id]`

Partial update. Any of `name`, `url`, `format`, `enabled`, `events`,
`include_recording_link` can be
sent. Sending a new `url` rotates the encrypted secret; omitting `url`
preserves the previous one. Sending an empty `url` is a no-op (use DELETE
to remove a webhook entirely). Patches that change `url` or `format` are
re-validated against the merged resulting pair (see compatibility rule above).

### `DELETE /api/podcasts/[slug]/webhooks/[id]`

Removes a webhook permanently.

### `POST /api/podcasts/[slug]/webhooks/[id]/test`

Fires a synthetic event through the webhook. Body: `{ event? }` — defaults
to the first event the webhook subscribes to (or `episode.publish`). 502s
with the upstream error if delivery fails.

### `GET /schedule/event/[token].ics`

One-off "add to calendar" download for a single episode's recording slot —
the link that recording webhooks put in their message. Unauthenticated by
design: it's handed out in chat channels where there's no per-user session,
so the signed token *is* the credential. Not a subscription; it serves
exactly one `VEVENT` (the REC event, never the DROP one) and sets
`Content-Disposition: attachment` so the browser hands it to the calendar app.

The token is `<episode_id>-<0|1>-<hmac>`, signed with `NUXT_SECRET_KEY`. The
middle digit is the recording-link disclosure flag and is covered by the
signature — tampering with it, or with the episode id, yields 404. Also 404s
when the episode is gone, its podcast is soft-deleted, or the recording slot
has since been cancelled. Rotating `NUXT_SECRET_KEY` invalidates every
outstanding link.

Distinct from `GET /schedule/[token].ics`, which is a per-user *subscription*
feed covering a whole podcast or network. That feed is authenticated by its
own revocable token and always includes the recording link.

### Network-scoped webhooks (admin-only)

The same shape lives under
`/api/admin/networks/[id]/webhooks` (+`/[webhook_id]`, `/[webhook_id]/test`).
Network webhooks fan out across every podcast in the network when a matching
event fires (in addition to any per-podcast webhooks). All five endpoints
require admin auth — scoped API keys cannot manage network webhooks.

### `GET /api/podcasts/[slug]/aliases`

Returns this podcast's previous slugs (chronological). Each old slug
permanently serves the feed with `<itunes:new-feed-url>` pointing at the
canonical URL. Aliases can never be reused (by this podcast or any
other) — the whole point is permanence for subscriber continuity.

### `GET /api/podcasts/[slug]/export.json`

Downloads a full Podshelf archive for this podcast: settings, all
episodes (drafts + scheduled + published), people roster, episode_people
attachments, and slug aliases. Excludes secrets (storage / GitHub /
webhook URLs), members, api_keys, audit_log, downloads. Importable into
another Podshelf instance via the import-json endpoint below.

### `POST /api/podcasts/[slug]/import-json`

Body: a Podshelf archive JSON (the output of `export.json`). Restores
into an empty target podcast — same constraint as the RSS importer.
Existing settings on the target are preserved unless they're empty / at
schema defaults; episodes/people/aliases are inserted fresh with new
ids while preserving the relations between them.

### Storage migration

End-to-end copy of every audio + artwork file from the podcast's current
storage to a new adapter or host, plus a database rewrite of every
matching URL.

| Endpoint                                         | Purpose                                                     |
|--------------------------------------------------|-------------------------------------------------------------|
| `POST /api/podcasts/[slug]/storage/migrate`      | Body: `{ adapter, config }` — queues a migration            |
| `GET  /api/podcasts/[slug]/storage/migrate`      | Returns the most-recent migration row (poll for progress)   |

Source files are not deleted. The active storage config swaps to the
target only after every file copies successfully — a half-finished
migration leaves the podcast on its original storage with stray files at
the target. Re-running skips files already present at the target, so
retries are safe. New uploads (audio, artwork, transcript, chapters) are
blocked while a migration is in progress.

### Distribution destinations

Per-podcast list of "Listen on" destinations (Apple, Spotify, Pocket Casts,
etc.). Pure metadata for the operator's reference. **Not** surfaced in the
RSS feed — but exposed via the API so a static-site build (e.g. one
triggered by `repository_dispatch` on episode publish) can pull this list
on each rebuild and render a "Listen on" block.

Each row has `name` (required), `url`, `platform_id` (the show's ID on that
platform — Apple show ID, Spotify URI, etc.), and free-form `notes`. Order
is preserved via `position`.

| Endpoint                                                | Purpose                                |
|---------------------------------------------------------|----------------------------------------|
| `GET    /api/podcasts/[slug]/distribution`              | List destinations in display order     |
| `POST   /api/podcasts/[slug]/distribution`              | Add — body: `{ name, url?, platform_id?, notes? }` |
| `PATCH  /api/podcasts/[slug]/distribution/[id]`         | Update any of `name`, `url`, `platform_id`, `notes` |
| `DELETE /api/podcasts/[slug]/distribution/[id]`         | Remove a destination                   |
| `POST   /api/podcasts/[slug]/distribution/reorder`      | Body: `{ ids: [3, 1, 2] }` — rewrites positions |

Reorder requires the request to contain exactly the same set of ids the
podcast currently has — partial reorders are rejected.

---

### Corrections

Factual errors reported by listeners. The downstream static sites are
prerendered and have no server of their own, so their "report a correction"
forms POST to Podshelf's **public, unauthenticated** endpoint; podcast members
then triage the results.

Reads and triage require membership — a submission can carry the listener's
contact details, so there is no public read surface. `ip_hash` and `user_agent`
are stored for rate limiting and are never projected by the API.

#### `POST /api/public/corrections` *(no auth)*

```json
{
  "podcast_slug": "ys100m",
  "episode_slug": "ys100m-wheres-the-finish",
  "timecode": "1:04:12",
  "claim": "What we said on the show",
  "correction": "What is actually true",
  "source_url": "https://example.com/proof",
  "name": "Optional submitter name",
  "contact": "Optional email or handle",
  "hp": ""
}
```

Only `podcast_slug`, `claim` and `correction` are required. Returns
`{ "ok": true }`.

Abuse controls, in order of application:

| Gate | Behavior |
|---|---|
| Honeypot (`hp`) | Non-empty → `200 { ok: true }` and **nothing is stored**. A 400 would just teach the bot which field to skip. |
| Length caps | `claim`/`correction` ≤ 4000 chars, other strings ≤ 300 → `400` |
| `source_url` scheme | Must be `http(s)` — it renders as a clickable link in the webhook and admin UI → `400` |
| Unknown/inactive podcast | `404` (same response for both, so the endpoint can't enumerate hidden shows) |
| Rate limit | More than **5 submissions per IP hash per hour** → `429` |

CORS: the allowed origins are derived from the `podcasts.website` column of
every **active** podcast — no separate allowlist to maintain, so a new sister
site is accepted as soon as its podcast record has a website. `localhost` is
additionally allowed off-production for local development. An `OPTIONS`
preflight is served at the same path.

An unresolvable `episode_slug` is not an error: `episode_id` stays null but the
raw slug is retained so the hosts can still see which episode was meant.

Every submission writes a `correction.submit` audit entry and fires the
`correction.submitted` webhook event (see [Webhooks](#post-apipodcastsslugwebhooks)) —
subscribe a Discord webhook to it to get pinged when one lands.

#### Triage *(membership required)*

| Endpoint                                         | Purpose |
|--------------------------------------------------|---------|
| `GET   /api/podcasts/[slug]/corrections?status=`  | List newest-first. `status` ∈ `new`, `confirmed`, `rejected`, `aired`, `all` |
| `PATCH /api/podcasts/[slug]/corrections/[id]`     | Body: `{ status?, resolution_note?, aired_episode_id? }` |

The submitted content itself (`claim`, `correction`, `submitter_*`) is
immutable — it's a record of what a listener told us, not a document we edit.
`aired_episode_id` must belong to the same podcast.

---

## Networks

A network groups sibling podcasts so members of any one of them can see
read-only scheduling intent across the others. Membership for visibility is
**implicit**: if you belong to any podcast in a network (via `podcast_users`),
you can read that network. There is no `network_users` table; networks never
widen edit access, only add a read surface.

API-key scoping intersects with the network. A key scoped to podcast A can
read networks A belongs to, but the `upcoming-episodes` endpoint returns
episodes only from podcasts inside the key's scope — a network can never
widen a key's data view.

### `GET /api/networks`

Lists networks the caller can read. Admins see all networks. Non-admins see
only networks whose active-podcast set intersects their `podcast_users`
membership.

Optional `?podcastSlug=foo` filter — restricts the result to networks
containing that podcast (used by the in-app scheduling conflict hint).

Each row: `{ id, slug, title, description, podcast_count }`.

### `GET /api/networks/[slug]`

Network detail. Returns the network plus its active-podcast roster ordered
by position, then title. Soft-deleted podcasts are filtered.

```json
{
  "id": 1,
  "slug": "teampumaknife",
  "title": "Team Puma Knife",
  "description": null,
  "podcasts": [
    { "id": 5, "slug": "you-said-100-miles", "title": "You Said 100 Miles?", "image_url": "…", "timezone": "America/New_York", "position": 0 }
  ]
}
```

### `GET /api/networks/[slug]/upcoming-episodes`

Aggregated upcoming and recently-published episodes across the network's
podcasts. Drafts are always excluded. Used by both the network dashboard
timeline and the inline scheduling conflict hint.

Query params:

| Param | Default | Notes |
|---|---|---|
| `from` | now | ISO datetime — lower bound on `published_at` |
| `to` | now + 60 days | ISO datetime — upper bound |
| `excludePodcast` | _none_ | Podcast slug to omit from results (the host's own show, when used by the inline hint) |

Response: `{ episodes: [...] }`. Each episode includes podcast id/slug/title/
image/timezone for rendering without a second round trip.

### `POST /api/admin/networks` *(admin only)*

Creates a network. Body: `{ slug?, title, description? }`. Slug must not
collide with an existing network slug or any podcast slug.

### `PATCH /api/admin/networks/[id]` *(admin only)*

Edits metadata. Re-slugging is allowed under the same uniqueness rules.

### `DELETE /api/admin/networks/[id]` *(admin only)*

Hard-deletes the network. Cascades to `network_podcasts`; the podcasts
themselves are untouched.

### `POST /api/admin/networks/[id]/podcasts` *(admin only)*

Adds a podcast to a network. Body: `{ podcast_id, position? }`. Returns the
updated roster. Re-adding an existing pairing is a no-op.

### `PATCH /api/admin/networks/[id]/podcasts/[podcast_id]` *(admin only)*

Updates the membership's position. Used by the admin reorder UI.

### `DELETE /api/admin/networks/[id]/podcasts/[podcast_id]` *(admin only)*

Removes a podcast from a network. The podcast is untouched.

### `GET /api/admin/networks` *(admin only)*

Admin listing of every network with its current active-podcast count.

### Custom properties

A network can declare a small schema of extra fields (custom properties)
that downstream static-site builds can read alongside the podcast roster.
Each network defines its own schema; the same key can be reused freely
across networks.

- Values are stored per `(network, podcast)` — a podcast in two different
  networks can carry different values.
- Supported `type` values: `string`, `boolean`, `number`, `url`, `color`.
  All values are stored as TEXT and coerced to the declared type on read.
- `required: true` is a documentary hint for consumers and the admin UI.
  It is **not** enforced server-side on writes; missing values are returned
  as `null`.
- Mutations are admin-only (`requireAdmin` rejects scoped API keys). Reads
  follow the same scope rules as the rest of the network surface: a scoped
  API key only sees values for podcasts inside its scope.

#### `GET /api/networks/[slug]/property-definitions`

Lists the network's property schema:

```json
[
  { "id": 1, "key": "accentColor", "label": "Accent Color",
    "description": "Hex color used for show-specific theming on the network landing page.",
    "type": "color", "required": 0, "position": 0 }
]
```

`description` is optional documentation surfaced as a tooltip in the admin UI
next to each property and on the per-podcast value editors. `null` when unset.

#### `GET /api/networks/[slug]/properties`

Flat list of all values across the network's roster (excluding orphan
keys whose definition has been deleted):

```json
{
  "properties": [
    { "podcast_id": 5, "podcast_slug": "you-said-100-miles",
      "key": "accentColor", "value": "#e66b2c", "type": "color" }
  ]
}
```

#### `GET /api/networks/[slug]?include=properties`

Convenience: returns the existing network-detail response with a typed
`properties: { key: value }` map attached to each podcast. Without
`?include=properties` the response is byte-identical to the original.

#### `POST /api/admin/networks/[id]/property-definitions` *(admin only)*

`{ key, label, description?, type, required?, position? }`. Key must match
`^[a-zA-Z][a-zA-Z0-9_]*$`. Defaults `position` to the end. 409 on
duplicate key for the same network.

#### `PATCH /api/admin/networks/[id]/property-definitions/[key]` *(admin only)*

Update label, description, type, required, or position. When `type` changes,
every existing value for the property must coerce under the new type —
otherwise the request 409s with the offending value so it can be edited first.

#### `DELETE /api/admin/networks/[id]/property-definitions/[key]` *(admin only)*

Drops the definition and cascades all stored values for that key in a
single transaction. Response includes `values_cleared` count.

#### `PUT /api/admin/networks/[id]/podcasts/[podcast_id]/properties/[key]` *(admin only)*

Set a value. `{ value }` body. Validated against the property's declared
type. Blank `value` is rejected — use DELETE to clear instead.

#### `DELETE /api/admin/networks/[id]/podcasts/[podcast_id]/properties/[key]` *(admin only)*

Clear one value. Idempotent (200 even if no row existed).

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

Create an episode. `title` is optional for drafts but required when `status`
is `scheduled` or `published` — the server returns 400 if you try to
publish a title-less episode. Recommended: `audio_url` (or upload
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
When both are blank (title-less draft), the slug falls back to
`untitled-YYYY-MM-DD` with a numeric suffix on collision. On a later PATCH
that fills in the title, the placeholder slug regenerates from the new
title automatically — unless you supply an explicit `slug` in the same
patch, in which case yours wins.

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
| `recording_location_type` | How the episode is recorded: `in_person`, `remote`, or `mixed`. Omit or send `null` for "not specified". Admin metadata — not in the RSS feed. |
| `recording_link`     | http(s) URL of the remote recording room (Zoom, Riverside, …). Only stored when `recording_location_type` is `remote` or `mixed` — the server writes `null` otherwise, including when a patch flips the type to `in_person` without mentioning the link. |

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
- `GET/POST/DELETE /api/podcasts/[slug]/members/...` — grants/revokes user
  access. POST accepts `{ user_id }` or `{ email }`.

See the source for full schemas — they're not the typical handoff path.

## Users *(admin only)*

User records carry `email`, `is_admin`, and two optional name fields:
`full_name` (real / billing name) and `display_name` (pod handle, e.g.
"Bucket Hat Bob"). Display name takes precedence in member lists when set.

- `GET /api/users` — list everyone (no password hashes).
- `POST /api/users` — body `{ email, password, is_admin?, full_name?, display_name? }`.
- `PATCH /api/users/[id]` — accepts any of `email`, `password`, `is_admin`,
  `full_name`, `display_name`. Pass `null` or `""` to clear a name.
- `DELETE /api/users/[id]` — cascades to `podcast_users` and `api_keys`.
- `GET /api/users/search?q=…` — typeahead. Substring match on email,
  full_name, or display_name; capped at 10 results. Powers the Grant Access
  modal on the podcast Members page.
- `GET /api/users/[id]/podcasts` — podcasts this user is a member of.
- `PUT /api/users/[id]/podcasts` — body `{ podcast_ids: number[] }`.
  Replaces the user's full membership set; diffs against current and emits
  per-affected-podcast `podcast.member.add` / `podcast.member.remove` audit
  entries. Used by the "Manage podcast access" item in the users hamburger.

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
  "auto_trigger": true,
  "pending": {
    "first_at": "2026-05-09T19:13:00.000Z",
    "last_at": "2026-05-09T19:18:00.000Z",
    "scheduled_for": "2026-05-09T19:33:00.000Z",
    "debounce_minutes": 15
  }
}
```

`pending.last_at` is non-null when the podcast has feed-visible changes that
haven't been published yet. `scheduled_for` = `last_at + debounce_minutes`.

This endpoint is admin-gated when the podcast has `build_admin_only=true`
(default). Non-admin members read the same `pending` block via
`GET /api/podcasts/[slug]/publish-status` (next).

### `GET /api/podcasts/[slug]/publish-status`

Read-only view of build state for the pending-changes banner. Open to any
podcast member regardless of `build_admin_only` — no secrets exposed.

```json
{
  "configured": true,
  "auto_trigger": true,
  "pending": {
    "first_at": "2026-05-09T19:13:00.000Z",
    "last_at": "2026-05-09T19:18:00.000Z",
    "scheduled_for": "2026-05-09T19:33:00.000Z",
    "debounce_minutes": 15
  }
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
Also clears any pending-changes window so the banner disappears. **Open to
any podcast member**; only the configuration form (above) is admin-only when
`build_admin_only=true`.

### Auto-trigger semantics

`auto_trigger` is **debounced** — feed-visible changes mark the podcast
"dirty" and the in-process scheduler fires one consolidated dispatch
**15 minutes after the most recent change**. A flurry of edits (10 saves
in 5 minutes) coalesces into one build, not ten. Each new change resets
the timer.

Changes that mark a podcast dirty:

- Episode created with `status=published`
- Episode updated where the previous OR new state was published
- Episode deleted that was published
- Podcast settings updated for any feed-visible field (title, description,
  author, image, language, copyright, category, explicit, website,
  audio_tracking_prefix)
- RSS import that imported at least one item

Drafts and storage/GitHub config edits never fire — only changes that
actually affect the published RSS feed.

When `auto_trigger=false`, dirty markers still accumulate (the banner shows
"5 edits since 2:13 PM") but the scheduler won't fire — the user must hit
**Rebuild Now**.

**Exception: scheduled-episode go-lives.** When the in-process scheduler flips
a `scheduled` episode to `published` (the `episode-schedule` source path), the
GitHub dispatch fires **immediately and unconditionally** — it bypasses both
`auto_trigger` and the 15-minute debounce. Rationale: the user committed to the
publish when they scheduled it, and `auto_trigger` exists to coalesce human edit
flurries, not gate one-shot scheduled go-lives. The `deploys_paused` kill switch
is still honored. The audit log records this as
`podcast.github.scheduled-publish` (or `…scheduled-publish.fail`).

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

The `client_payload` Podshelf sends includes
`{ slug, reason, podcast_id, fired_at }`. `slug` is the Podshelf slug of the
podcast that triggered the build (e.g. `ys100m`, `ywiw`); `reason` is one of
`podshelf:manual` / `podshelf:test` / `podshelf:auto-debounced`. Receiving
workflows can label runs with the slug:

```yaml
run-name: ${{ github.event.client_payload.slug || 'manual' }}
```

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
