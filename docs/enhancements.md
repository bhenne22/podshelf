# Enhancements

Running list of ideas to consider — not commitments. Roughly ordered by
priority within each section.

## Operational hardening

- **Off-site DB backup to NAS.** A nightly cron exists on the Linode that
  snapshots `/opt/podshelf/data/podshelf.db`; add a second job that ships
  that snapshot off-box to the home NAS so a Linode loss doesn't take the
  data with it.


## Publishing workflow

- **Bulk operations on drafts.** Multi-select + bulk delete / bulk publish /
  bulk re-tag. ~ Not going to do. Frequency of having enough drafts that need 
  a bulk edit should be quite low, and if there really is a need there's a 
  robust API that could be handed off to an AI assistant.


## Mobile / install

- **PWA manifest + service worker.** Lets Podshelf be installed to a phone
  home screen. Doesn't need to be sophisticated — just a manifest and an
  icon set; the existing mobile-friendly UI handles the rest. ~ Not going to
  do. No tangible benefit at this time.  

## Analytics (deferred)

The `/track/` redirect and download counting infrastructure already exist
but aren't actively used. When ready to revisit:

- Restore the Analytics nav entry that was hidden in commit a4a7b71.
- Surface the per-podcast dashboard download cards conditionally
  (`audio_tracking_prefix` includes `/track/`) — already wired up.
- Per-episode page view (downloads-over-time chart).
- User-agent parsing (Apple Podcasts vs Overcast vs Spotify vs other).
- Geographic heatmap from the existing GeoIP-stamped rows.
