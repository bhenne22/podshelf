# Enhancements

Running list of ideas to consider — not commitments. Roughly ordered by
priority within each section. Strike entries out (`~~item~~`) when shipped
rather than deleting; keeps the rationale findable.

## Operational hardening

- **Off-site DB backup to NAS.** A nightly cron exists on the Linode that
  snapshots `/opt/podshelf/data/podshelf.db`; add a second job that ships
  that snapshot off-box to the home NAS so a Linode loss doesn't take the
  data with it.
- **Webhook on publish.** Hit a Discord / Slack / Mastodon webhook when an
  episode goes live. Same pattern as the existing GitHub `repository_dispatch`
  trigger but aimed at humans instead of CI.
- ~~**Health check endpoint.** `GET /healthz` returning 200 + a DB ping. Wire
  into uptime-kuma alongside the other `*.hennemo.com` services.~~ Shipped:
  `server/routes/healthz.get.ts` returns `{ status: 'ok' }` on a successful
  `SELECT 1` ping, 503 with the error message otherwise. Still needs the
  uptime-kuma monitor wired up.
- **Audit log.** Per-podcast log of who changed what when — settings edits,
  episode publishes, member adds, deletes. Becomes essential if a podcast
  ever has multiple editors.

## Publishing workflow

- **Scheduled publishing.** Set `published_at` in the future and have the
  episode auto-flip to `published` when the time hits. Verify what the RSS
  feed currently does with a future-dated published episode before adding —
  may need to filter `published_at <= now` in the feed query.
- **Episode duplication.** "Duplicate this episode" / "save as template" —
  great for shows with consistent structure (recurring intro, outro, tag
  set).
- **Bulk operations on drafts.** Multi-select + bulk delete / bulk publish /
  bulk re-tag.
- **Search across episodes.** Title / tag / description, scoped per podcast.
  Becomes essential past ~50 episodes.
- ~~**Slug change in the Settings UI.** Add `slug` to the `UPDATABLE` list in
  `index.patch.ts`, validate (lowercase, hyphenated, unique, not blank),
  show a clear warning about feed/bookmark breakage. Trivial to implement;
  doesn't include feed-migration tags (see below).~~ Shipped: server-side
  format + uniqueness checks in `index.patch.ts`, slug field on the Settings
  page with an inline warning + `confirm()` dialog when changed, then
  redirect to the new URL on success.
- **Slug change with feed migration.** For an actively-subscribed podcast,
  keep the old feed alive temporarily and emit
  `<itunes:new-feed-url>` so subscribers' apps auto-follow. Needs a
  `slug_aliases` table (or `previous_slug` column) and an extra route in
  `feeds/[slug].xml.ts`. Only worth it once a podcast has real subscribers.

## Feed quality (Podcasting 2.0)

The modern podcast ecosystem has standardised on the `podcast:` XML namespace
for things the iTunes namespace doesn't cover. Adopting these makes Podshelf
feeds first-class in Pocket Casts, Fountain, Castamatic, etc.

- ~~**`<podcast:guid>`** at the channel level — a stable identifier so apps
  can keep subscribers if the feed URL ever changes. Trivial to add, big
  payoff. Do this **before** acquiring real subscribers.~~ Shipped: new
  `podcasts.guid` column, lazily computed as a UUIDv5 of the normalized feed
  URL on first feed render and persisted, then emitted as
  `<podcast:guid>` (with the `xmlns:podcast` namespace) in the channel.
- ~~**Stable per-episode `<guid>`.**~~ Shipped: new `episodes.guid` column.
  The feed handler lazily locks in the existing URL-as-GUID value (so
  in-flight subscribers don't see every episode as "new"), then future slug
  or website changes leave the GUID untouched. The RSS importer preserves
  both the source feed's channel `<podcast:guid>` and per-item `<guid>`
  values, so migrating an existing podcast onto Podshelf doesn't churn
  subscribers.
- ~~**Channel-level feed elements.** `<atom:link rel="self">`, `<itunes:type>`,
  `<podcast:locked>`, `<lastBuildDate>`.~~ Shipped: feed root now declares
  the `xmlns:atom` namespace and emits all four. New `podcasts.itunes_type`
  (episodic/serial) and `podcasts.podcast_locked` (yes/no) columns with
  Settings UI controls.
- ~~**Per-episode `<itunes:episodeType>`.**~~ Shipped: new
  `episodes.episode_type` column (full/trailer/bonus, default `full`),
  validated in the create / patch endpoints, exposed in both episode forms,
  captured by the RSS importer, and emitted in the feed.
- ~~**RSS importer pulls channel metadata.**~~ Shipped: importer now
  backfills `description`, `author`, `image_url`, `language`, `copyright`,
  `category`, `explicit`, `itunes_type`, `podcast_locked` from the source
  channel into the podcast row — but only into fields that are currently
  empty or still at their schema default, so any pre-import edits the user
  made win. Channel `<podcast:guid>` continues to overwrite (subscriber
  continuity is the entire point).
- **`<podcast:transcript>`** per episode — the `transcript_path` column
  already exists in the schema; just plumb it through the episode form and
  the feed.
- **`<podcast:chapters>`** — chapter list with timestamps. Probably a
  separate "chapters" textarea on the episode form that gets rendered as a
  sidecar JSON file at a stable URL.

## Migration tools

- **RSS export.** The inverse of the existing importer. Always good to have
  a documented exit ramp; also handy when moving a podcast between Podshelf
  instances.
- **Storage migration.** "Copy all audio from SFTP to S3 (or vice versa) and
  rewrite `audio_url` for matching files." Useful when a host gets too
  expensive or unreliable.

## Mobile / install

- **PWA manifest + service worker.** Lets Podshelf be installed to a phone
  home screen. Doesn't need to be sophisticated — just a manifest and an
  icon set; the existing mobile-friendly UI handles the rest.

## Analytics (deferred)

The `/track/` redirect and download counting infrastructure already exist
but aren't actively used. When ready to revisit:

- Restore the Analytics nav entry that was hidden in commit a4a7b71.
- Surface the per-podcast dashboard download cards conditionally
  (`audio_tracking_prefix` includes `/track/`) — already wired up.
- Per-episode page view (downloads-over-time chart).
- User-agent parsing (Apple Podcasts vs Overcast vs Spotify vs other).
- Geographic heatmap from the existing GeoIP-stamped rows.
