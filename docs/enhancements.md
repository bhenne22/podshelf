# Enhancements

Running list of ideas to consider — not commitments. Roughly ordered by
priority within each section. Strike entries out (`~~item~~`) when shipped
rather than deleting; keeps the rationale findable.

## Operational hardening

- **Off-site DB backup to NAS.** A nightly cron exists on the Linode that
  snapshots `/opt/podshelf/data/podshelf.db`; add a second job that ships
  that snapshot off-box to the home NAS so a Linode loss doesn't take the
  data with it.
- ~~**Webhook on publish.** Hit a Discord / Slack / Mastodon webhook when an
  episode goes live. Same pattern as the existing GitHub `repository_dispatch`
  trigger but aimed at humans instead of CI.~~ Shipped: per-podcast webhook
  with format selector (`discord` / `slack` / `generic`) and `enabled`
  toggle. URL is encrypted at rest like the GitHub token. New
  `firePublishEvent()` helper in `server/utils/publish-event.ts` is the
  single fan-out point for "an episode just became live" — bumps the feed
  cache, fires the GitHub auto-trigger, and posts the webhook in the
  configured shape. Used by immediate-publish endpoints and the
  scheduler. Settings UI has a Send-test button. Mastodon deferred — it
  needs an OAuth2 token, not a webhook; users can bridge through n8n.
- ~~**Audit log.** Per-podcast log of who changed what when — settings edits,
  episode publishes, member adds, deletes. Becomes essential if a podcast
  ever has multiple editors.~~ Shipped: new `audit_log` table (per-podcast,
  nullable `user_id` for system events). `server/utils/audit.ts` exposes
  `logAudit()` + `diffFields()`; mutating endpoints (podcast CRUD,
  episode CRUD, chapters, people, episode_people, members, storage,
  GitHub config + manual trigger, RSS import, webhook, scheduled
  publishing flips) all log into it. Settings/episode edits include a
  field-level diff (changed names + before/after). Viewer page at
  `/podcasts/[slug]/audit` paginates by id, expandable rows show the
  full diff in a table. Visible to all podcast members.

## Publishing workflow

- ~~**Scheduled publishing.** Set `published_at` in the future and have the
  episode auto-flip to `published` when the time hits.~~ Shipped: new
  `scheduled` status. `coerceScheduledStatus()` in
  `server/utils/scheduler.ts` saves an episode as `scheduled` (not
  `published`) when `status='published'` + `published_at` is in the
  future. Server-side scheduler boots from `server/plugins/scheduler.ts`
  and runs every 60s, flipping eligible rows and firing
  `firePublishEvent()` (webhook + GitHub + cache bump) in the background.
  The feed handler also calls `processScheduledFlips(podcastId)` on every
  render as a belt-and-suspenders fallback in case the in-process timer
  is dead. Episode list has a Status filter and a "Scheduled" badge;
  edit page shows a "Scheduled for X" banner.
- ~~**Episode duplication.** "Duplicate this episode" / "save as template" —
  great for shows with consistent structure (recurring intro, outro, tag
  set).~~ Shipped: `POST /api/podcasts/[slug]/episodes/[id]/duplicate`
  clones an episode as a draft. Carries description, tags, image_url,
  season + season_name, episode_type, itunes_title/author, license
  override, and people attachments (frozen role/group). Clears audio,
  chapters, transcript, episode_number, episode_display, published_at,
  guid. Title appended " (Copy)", new slug derived. "Duplicate" button
  on the episode edit page redirects to the new draft.
- **Bulk operations on drafts.** Multi-select + bulk delete / bulk publish /
  bulk re-tag.
- ~~**Search across episodes.** Title / tag / description, scoped per podcast.
  Becomes essential past ~50 episodes.~~ Shipped: search input in the
  episode-list filter strip, debounced 200ms, runs case-insensitive
  substring match against title / tags / description on the already-
  fetched list. Composes with status / season / date filters. Pure
  client-side filter for now — server-side LIKE only matters past tens
  of thousands of episodes per podcast, which we're nowhere near.
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
