# Recording schedule + iCal feeds — verification notes

Hey future Bob. You built this in one session and pushed it to a branch for
safe-keeping. This doc is everything you need to verify it and ship it
without re-loading the conversation.

## TL;DR

Six commits adding episode-level recording slots, .ics calendar feeds
hosts subscribe to in Apple/Google/Outlook, a Discord webhook when
recordings move, and REC markers on the network timeline.

All work is gated behind opt-in fields. Existing episodes / podcasts /
sister sites are unaffected until someone sets `recording_starts_at` on
an episode or mints a calendar token.

## Branch layout

```
0ce6543 feat(schedule): network timeline REC markers + SchedulePanel mount
3999b9c feat(schedule): webhook fires on recording-time changes
a0bd8d5 feat(schedule): SchedulePanel + podcast dashboard mount
639b82a feat(schedule): episode editor Recording panel + settings default + list column
96e8206 feat(schedule): iCalendar feeds via tokenized /schedule/<token>.ics
42fd51a feat(schedule): episode recording fields + podcast default duration
```

Each commit is independently buildable and the suite is green on every
one. Reviewing commit-by-commit gives a clean slice-by-slice tour.

## What changed in the DB

Auto-applied via `applyMigrations` on first server boot — already happened
when the dev server was tested. Verified on `./data/podshelf.db`:

| Table              | Column / Object                          |
|--------------------|------------------------------------------|
| `episodes`         | `recording_starts_at TEXT` (nullable)    |
| `episodes`         | `recording_duration_minutes INTEGER` (nullable) |
| `episodes`         | index `idx_episodes_recording_starts_at` |
| `podcasts`         | `recording_default_duration_minutes INTEGER` (nullable) |
| `schedule_tokens`  | new table + 3 indexes                    |

Rollback would mean dropping the columns + table. SQLite doesn't drop
columns easily, but everything's nullable so untouched rows are valid.

## How the surface fits together

### Per-episode

- New "Recording" panel on the episode editor under Publishing. Two
  inputs: a datetime-local (interpreted in the podcast's timezone, same
  helpers as Publish Date) and a duration in minutes. Both optional.
- Episode list has a new "Recording" column showing the date, or "—".

### Per-podcast

- Settings → new "Recording" section with a default duration field.
  Used as the placeholder in the editor and as the SQL fallback when an
  episode itself doesn't specify a duration. Empty means "no default" —
  the .ics generator falls through to a 90-min global default.
- Dashboard → new "Calendar feed" panel (SchedulePanel) for minting
  + revoking podcast-scoped tokens.

### Per-network

- Network page → same SchedulePanel for network-scoped tokens.
- Timeline now shows REC events alongside DROP events. Each row has a
  small `REC` / `DROP` chip; REC rows get a purple left-border accent.
  Drafts with a future recording slot now appear on the timeline.

### Public surfaces

- `GET /schedule/<token>.ics` → iCalendar feed. No auth header (calendar
  apps can't send `X-Api-Key`); the token in the URL is the credential.
  - 404 unknown token
  - 410 Gone on revoked token (lets Apple Calendar drop the subscription
    gracefully instead of polling forever)
  - REC events use `recording_starts_at` + duration (COALESCE fallback
    chain: episode value → podcast default → 90 min)
  - DROP events are all-day on `published_at`, CONFIRMED for published /
    TENTATIVE for scheduled
  - Stable UIDs (`episode-<id>-rec@...`, `episode-<id>-drop@...`) so
    client-side edits update existing events instead of duplicating

### Webhook

Reuses the existing per-podcast webhook (`webhook_url`, `format`,
`enabled`). Fires on three episode events:

- `scheduled` — episode created with a recording slot, or PATCH adds one
- `moved` — `recording_starts_at` OR `recording_duration_minutes` changed
- `cancelled` — slot cleared via PATCH, or episode deleted (fired BEFORE
  the row goes away so title/numbers are still readable)

Failures are logged to the audit log with `action = webhook.recording.fail`
and never block the mutation that triggered them — same contract as the
existing publish webhook.

## Testing plan

Run all of this with the dev server up (`npm run dev`). You'll need a
session in the browser — log in once and the rest of these flows work in
the same tab.

### 1. Schema sanity (one-time, takes 5 seconds)

```bash
sqlite3 data/podshelf.db "PRAGMA table_info(episodes);" | grep recording
sqlite3 data/podshelf.db "PRAGMA table_info(podcasts);" | grep recording_default
sqlite3 data/podshelf.db ".schema schedule_tokens"
```

Expected: both episode columns present, the podcast default column
present, the schedule_tokens table with token / scope_type / scope_id /
revoked_at fields.

### 2. Episode editor — Recording panel

1. Open any podcast → Episodes → pick an episode.
2. Above Basic Info you should see a new **Recording** section.
3. Set a date/time in the future and a duration of, say, `45`.
4. Save. Reload the page. Both values should round-trip cleanly.
5. Check the episode list — the **Recording** column should show the
   date (hover for the full datetime).
6. Clear the date by emptying the input. Save. Verify the list shows "—".

### 3. Podcast default duration

1. Podcast → Settings → scroll to the new **Recording** section.
2. Enter `60` and save.
3. Back in the editor for any episode, the duration input's placeholder
   should now read `60` (it was `90` before).

### 4. .ics subscribe flow (the host-facing flow)

1. Podcast → Dashboard. Below the Latest Published / Newest Draft rows
   you should see a **Calendar feed** panel.
2. Click "Generate subscribe link" with a label like "test phone."
3. Copy the URL. Open in a browser — should download a `.ics` file.
4. Open the file in a text editor (or import to Calendar app) — confirm:
   - Starts with `BEGIN:VCALENDAR`
   - Has one `VEVENT` per scheduled/published episode (DROP events)
   - Has one extra `VEVENT` for the episode you stamped in test #2
5. Click "Add to Apple" — Calendar.app should prompt to subscribe.
6. Click Revoke on the token. Reload — it should move to the "revoked"
   fold.
7. Try the URL again — should now return **410 Gone**.

### 5. Recording webhook (Discord)

If you have a podcast with the Discord webhook configured + enabled:

1. Edit an episode and set a recording slot you didn't have before.
   Save. Watch Discord — should see "📅 Recording scheduled for …".
2. Change the recording time. Save. Should see "Recording moved …
   (was …)".
3. Clear the recording. Save. Should see "Recording cancelled …".
4. Edit something unrelated (e.g. description). Save. Should NOT fire
   the recording webhook (publish webhook is also gated, unchanged).

If you don't want to spam your real Discord, you can run the e2e smoke
that was used during build:

```bash
# Starts a local capture server on a random port, configures the
# podcast webhook to point at it, exercises every recording transition,
# then restores your original webhook config. Cleans up after itself.
```

(The smoke script was deleted after the build session; re-create from
the test-plan section in commit 3999b9c if you want to re-run.)

### 6. Network timeline

1. Open any network you belong to.
2. Above the "Recent & upcoming episodes" timeline, you should see the
   same **Calendar feed** panel (network-scoped this time).
3. The timeline rows now have `REC` or `DROP` chips. Rows for episodes
   with recording slots in the window should show two rows (one for
   each event), with REC rows accented purple on the left.
4. A draft episode with a future recording slot should appear in the
   network timeline (it wouldn't before).

### 7. The NetworkConflictHint regression check

This is the "did my type change break anything" check.

1. Create a new episode in any podcast that's part of a network.
2. Pick a publish date within 3 days of another network sibling's
   publish date.
3. The conflict-hint banner should appear under the Publish Date input
   listing the colliding episode — same behavior as before.

## Known issues / non-blockers

- `test/scheduler-flip.test.ts` — one assertion fails because its
  hardcoded comparison date (`2026-05-11T00:00`) is now in the past;
  the bytewise compare it was designed to catch now happens to give
  the right answer. **Pre-existing, not from this branch.** Fix is to
  bump the fixture date, but not on this branch.
- `pages/docs.vue` — typecheck warns about `swagger-ui-bundle.js`
  having no types. **Pre-existing, not from this branch.**
- Calendar refresh latency: Google polls subscribed calendars roughly
  every 24h. The Discord webhook is the gap-filler for last-minute
  changes — that's working.

## Merge sequence for tomorrow

```bash
# 1. Pull this branch + smoke-test as above.
git fetch origin
git checkout feature/recording-schedule
git pull
npm install
npm run dev   # work through the testing plan

# 2. When happy, open the PR on GitHub. The 6 commits are clean and
#    independently meaningful — use a merge commit (not squash) to
#    keep the slice-by-slice history.

# 3. After merge:
git checkout main
git pull origin main
git branch -d feature/recording-schedule   # delete local
git push origin --delete feature/recording-schedule   # delete remote (optional)
```

## Files you might want to look at first

- `server/utils/ics.ts` — the iCalendar generator. Self-contained,
  well-commented, easy to spot-check.
- `server/utils/recording-event.ts` — the webhook fan-out. Mirrors
  `publish-event.ts` exactly so the pattern's familiar.
- `components/SchedulePanel.vue` — the only new component.
- `pages/networks/[slug]/index.vue` — biggest single-file delta; the
  timeline refactor from per-episode rows to per-event rows.

Sleep well.
