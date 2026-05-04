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
- **Slug change with feed migration.** For an actively-subscribed podcast,
  keep the old feed alive temporarily and emit
  `<itunes:new-feed-url>` so subscribers' apps auto-follow. Needs a
  `slug_aliases` table (or `previous_slug` column) and an extra route in
  `feeds/[slug].xml.ts`. Only worth it once a podcast has real subscribers.


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
