# RSS Feed Support

What Podshelf's public RSS feed includes, what it doesn't yet, and what it
deliberately won't. The feed lives at `/feeds/<slug>.xml` and is rendered
by `server/routes/feeds/[slug].xml.ts` from the SQLite row.

## Subscriber-continuity guarantees

The two things that matter for keeping subscribers when a feed moves
between hosts are stable identifiers and HTTP cache discipline. Podshelf
treats both as load-bearing:

- **`<podcast:guid>` is permanent.** Lazily computed as a UUIDv5 of the
  feed URL on first render and persisted to `podcasts.guid`. From that
  point on, slug changes, website changes, even feed-URL changes never
  touch it. RSS imports preserve the source feed's GUID verbatim.
- **Episode `<guid>` is permanent.** Lazily locked in to the current
  episode URL on first render, persisted to `episodes.guid`. RSS imports
  preserve the source feed's per-item `<guid>` verbatim. Slug or website
  changes after that don't churn the GUID.
- **`Last-Modified` + `If-Modified-Since`.** The feed handler tracks
  `podcasts.feed_last_modified` (bumped on episode CRUD on published
  episodes, podcast settings edits to feed-visible fields, and RSS
  import). It returns 304 Not Modified with no body when the request's
  `If-Modified-Since` is at or after the stored timestamp. Polite to
  podcast apps, saves bandwidth.
- **Scheduled episodes never leak.** Episodes with `status='scheduled'`
  are excluded from the feed query (it requires `status='published'`).
  An in-process timer runs every 60s and flips eligible scheduled rows;
  the feed handler also calls `processScheduledFlips(podcast.id)` on
  every render so a dead timer can't cause a missed publish window.

## What the feed includes

### Channel level

| Tag | Source |
|---|---|
| `<title>` | `podcasts.title` |
| `<link>` | `podcasts.website` |
| `<description>` | `podcasts.description` |
| `<language>` | `podcasts.language` |
| `<copyright>` | `podcasts.copyright` (omitted if blank) |
| `<lastBuildDate>` | render time |
| `<generator>` | constant: `Podshelf` |
| `<atom:link rel="self">` | `SITE_URL/feeds/<slug>.xml` |
| `<itunes:author>` | `podcasts.author` |
| `<itunes:type>` | `podcasts.itunes_type` (`episodic` or `serial`) |
| `<itunes:owner>` (name + email) | `podcasts.author` + `podcasts.email` |
| `<itunes:image>` | `podcasts.image_url` (omitted if blank) |
| `<itunes:category>` | `podcasts.category` (single category — see "won't support" for nesting) |
| `<itunes:explicit>` | `podcasts.explicit` |
| `<itunes:complete>` | `podcasts.itunes_complete` (only emitted when `yes`) |
| `<itunes:block>` | `podcasts.itunes_block` (only emitted when `yes`) |
| `<podcast:guid>` | `podcasts.guid` (lazily computed if null — see above) |
| `<podcast:medium>` | constant: `podcast` |
| `<podcast:locked>` | `podcasts.podcast_locked` (`yes` or `no`) |
| `<podcast:funding>` | `podcasts.funding_url` + `podcasts.funding_label` (omitted if URL blank) |
| `<podcast:txt purpose="verify">` | `podcasts.verify_txt` (omitted if blank) |
| `<podcast:license>` | `podcasts.license_identifier` + optional `url` from `podcasts.license_url` (omitted if both blank) |
| `<podcast:person>` | One per `people` row with `auto_attach=1`, using each person's *current* `default_role`/`default_group`/`name`/`img_url`/`href` |
| `<image>` | derived from `podcasts.image_url` + title + website |

Namespace declarations on the `<rss>` root: `itunes`, `content`, `atom`,
`podcast`.

### Item level

| Tag | Source |
|---|---|
| `<title>` | `episodes.title` |
| `<link>` | `<website>/episodes/<episode-slug>` |
| `<description>` | `episodes.description` (CDATA) |
| `<content:encoded>` | `episodes.description` (same — apps that prefer richer HTML use this) |
| `<pubDate>` | `episodes.published_at` (RFC 2822) |
| `<enclosure>` | `episodes.audio_url` (with `audio_tracking_prefix` prepended if set) + `audio_size_bytes` |
| `<guid isPermaLink="false">` | `episodes.guid` (lazily computed if null — see above) |
| `<itunes:summary>` | `episodes.description` |
| `<itunes:duration>` | `episodes.audio_duration_seconds` (formatted `H:MM:SS` or `MM:SS`) |
| `<itunes:episode>` | `episodes.episode_number` (omitted if blank) |
| `<itunes:season>` | `episodes.season_number` (omitted if blank) |
| `<itunes:image>` | `episodes.image_url` (omitted if blank) |
| `<itunes:episodeType>` | `episodes.episode_type` (`full`, `trailer`, or `bonus`) |
| `<itunes:title>` | `episodes.itunes_title` (omitted if blank) — the "clean" title without `S2E22:` prefix |
| `<itunes:author>` | `episodes.itunes_author` (omitted if blank) — overrides channel author for guest hosts |
| `<itunes:explicit>` | `episodes.itunes_explicit` (omitted if blank — episode inherits the channel default) |
| `<podcast:season>` | `episodes.season_number` (value) + optional `name` attr from `episodes.season_name` |
| `<podcast:episode>` | `episodes.episode_number` (value) + optional `display` attr from `episodes.episode_display` |
| `<podcast:transcript>` | `episodes.transcript_path` (`url`) + `episodes.transcript_type` (or guessed from extension; defaults to `text/html`) |
| `<podcast:chapters>` | `episodes.chapters_url` (`type="application/json+chapters"`) |
| `<podcast:license>` | `episodes.license_identifier` + optional `url` from `episodes.license_url` (overrides channel-level license; omitted if both blank) |
| `<podcast:person>` | One per `episode_people` row, using `episode_people.role` / `episode_people."group"` (frozen at attach time) joined with the person's *current* `name` / `img_url` / `href` |

## HTTP behavior

| Header | Behavior |
|---|---|
| `Content-Type` | `application/rss+xml; charset=utf-8` |
| `Last-Modified` | `podcasts.feed_last_modified` formatted as HTTP-date |
| `If-Modified-Since` (request) | Honored — returns 304 with no body when not modified |

Inactive (soft-deleted) podcasts return 404.

## Importer behavior

`POST /api/podcasts/<slug>/import-rss` runs only on empty podcasts (no
existing episodes). It reads from a source feed and:

- **Channel `<podcast:guid>`** — overwrites `podcasts.guid` unconditionally.
  The whole point is to inherit the source feed's identity for subscriber
  continuity.
- **Per-item `<guid>`** — written verbatim into `episodes.guid`.
- **Per-item `<itunes:episodeType>`** — captured into `episodes.episode_type`
  (defaults to `full` if missing).
- **Channel metadata backfill** — `description`, `author`, `image_url`,
  `language`, `copyright`, `category`, `explicit`, `itunes:type`,
  `podcast:locked`, `podcast:txt purpose="verify"`, and channel-level
  `podcast:license` (identifier + URL) are pulled from the source channel
  and written into the podcast row, but only into fields that are
  currently empty or still at their schema default. Pre-import edits the
  user made always win.
- **Per-item Podcasting 2.0 tags** — `<podcast:transcript>` (URL + type),
  `<podcast:chapters>` URL, `<podcast:season name>` and
  `<podcast:episode display>` values, per-item `<podcast:license>`,
  per-item `<itunes:title>` / `<itunes:author>` / `<itunes:explicit>` are
  captured into the corresponding `episodes.*` columns.
- **People** — channel-level `<podcast:person>` entries are inserted
  into the `people` table with `auto_attach=on` (so they're treated as
  regulars). Per-item `<podcast:person>` entries are deduped by name
  (case-insensitive) into the same roster, and `episode_people` rows
  attach them with role/group taken verbatim from the source.
- **Title and slug** are deliberately not backfilled — those are the
  user's choice when they create the podcast in Podshelf.

The response includes a `settings_backfilled` array listing which fields
came from the source.

## Planned (in `docs/enhancements.md`)

The big-ticket items still open:

- **Slug change with feed migration** — emit `<itunes:new-feed-url>` and
  keep the old slug responding for some grace period via a slug-aliases
  table. Worth it once a podcast has real subscribers.
- **RSS export** — the inverse of the importer.

## Won't support

These are skipped intentionally. The reason matters more than the list,
in case someone asks later.

| Tag | Reason |
|---|---|
| `<atom:link rel="hub">` / `<podcast:podping>` | Both advertise instant-push notification support (PubSubHubbub / Podping). Podshelf doesn't run that infrastructure and isn't going to. Polling is fine for self-hosted podcasts. |
| Nested `<itunes:category>` (Sports → Running) | Apple ignores everything past the second category anyway, and only Apple Podcasts surfaces sub-categories. Not worth a schema change. |
| `<podcast:value>` | Lightning streaming sats. Niche. Not relevant unless Podshelf is hosting podcasts in that ecosystem. |
| `<podcast:location>` | Geographic location of the show. Almost no apps surface it. |
| `<podcast:soundbite>` | Promo clips with timestamps. Used by Curio Caster and a few others. Little ecosystem traction. |
| `<podcast:liveItem>` | Live streaming. Podshelf is a published-feed platform, not a streaming server. |
| `<podcast:images srcset>` | Responsive image set per episode. Apple/Spotify don't honor it — single 1400px artwork is the durable answer. |
| `<podcast:remoteItem>` / federation | Federated content from other feeds. Outside Podshelf's scope as a single-instance host. |
| `<podcast:alternateEnclosure>` | Multiple audio/video qualities per episode. Adds complexity for marginal benefit; subscribers' bandwidth situation is the apps' problem. |
| `<itunes:keywords>` / `<itunes:subtitle>` | Both deprecated by Apple. Some apps still read them but the long-term arc is "don't bother." |
| `<sy:updatePeriod>`, `<sy:updateFrequency>`, `<ttl>`, `<skipHours>`, `<skipDays>` | Polling-frequency hints. Universally ignored by modern podcast apps. |
| `<docs>` | Link to the RSS spec. Required by some validators in 2008. Nobody enforces it now. |
| `<webMaster>` / `<managingEditor>` | Email addresses in the feed. `itunes:owner` already covers this and apps actually surface it. |
| `<atom:link rel="next">` / `rel="prev">` | Feed pagination. Useful past ~1000 episodes. We're nowhere near that and can revisit if Podshelf ever hosts a daily show. |
| Per-feed `<image><width>` / `<height>` | Apple/Spotify ignore them — they enforce 1400×1400 from the artwork itself. |
| `<dc:creator>` | Dublin Core author tag. Redundant with `itunes:author`. |
| `<rawvoice:*>`, `<wfw:commentRss>`, `<slash:comments>`, `<comments>`, `<category>` (per-item) | WordPress / RawVoice plugin extras. No podcast app reads them. |
| `<generator>` with version | We emit a static `Podshelf` string instead of leaking the running version. Not a security issue per se, but no upside to broadcasting it either. |
