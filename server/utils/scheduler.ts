import getDb from '../db/index'
import { firePublishEvent } from './publish-event'
import { logAudit } from './audit'
import {
  PUBLISH_DEBOUNCE_MINUTES,
  loadGithubConfig,
  clearPublishDirty,
  dispatchRepositoryEvent,
  isDeploysPaused,
} from './github'

interface ScheduledEpisode {
  id: number
  podcast_id: number
  title: string
  published_at: string
}

/**
 * Resolve the (status, publishedAt) pair to persist on save. Rules:
 *   - status='published' + future publishedAt → publish now (override
 *     publishedAt to current time). Selecting "Published" is an explicit
 *     intent to go live, so a leftover future date is treated as a stale
 *     value rather than silently scheduling.
 *   - status='published' + no publishedAt → fill in current time.
 *   - status='scheduled' or 'draft' → pass through unchanged. Users who
 *     want scheduling pick the Scheduled status explicitly.
 */
export function resolvePublishTiming(
  desiredStatus: string | null | undefined,
  publishedAt: string | null | undefined,
): { status: string | null | undefined; publishedAt: string | null | undefined } {
  if (desiredStatus !== 'published') {
    return { status: desiredStatus, publishedAt: publishedAt ?? null }
  }
  if (!publishedAt) {
    return { status: 'published', publishedAt: new Date().toISOString() }
  }
  const t = new Date(publishedAt).getTime()
  if (Number.isFinite(t) && t > Date.now()) {
    return { status: 'published', publishedAt: new Date().toISOString() }
  }
  return { status: 'published', publishedAt }
}

/**
 * Find scheduled episodes whose publish time has arrived and flip them to
 * 'published'. The DB update + audit log run synchronously; the publish
 * event (webhook + GitHub + cache bump) is fire-and-forget per episode so
 * a slow webhook server can't block the caller — important for the lazy
 * flip path inside the feed handler. Scoped to a single podcast when
 * `podcastId` is provided.
 */
export function processScheduledFlips(podcastId?: number): number {
  const db = getDb()
  // datetime() wraps both sides so SQLite normalizes the formats before
  // comparing. Without the wrap, comparison is bytewise — and published_at
  // is stored with a 'T' separator (e.g. "2026-05-11T07:00:00.000Z") while
  // datetime('now') outputs "2026-05-11 04:25:00" with a space. ASCII T(84)
  // > space(32), so the predicate evaluated FALSE for every well-formed
  // value and scheduled episodes never flipped.
  const sql = podcastId
    ? `SELECT id, podcast_id, title, published_at FROM episodes
       WHERE podcast_id = ? AND status = 'scheduled'
         AND published_at IS NOT NULL AND datetime(published_at) <= datetime('now')`
    : `SELECT id, podcast_id, title, published_at FROM episodes
       WHERE status = 'scheduled'
         AND published_at IS NOT NULL AND datetime(published_at) <= datetime('now')`
  const rows = (podcastId
    ? db.prepare(sql).all(podcastId)
    : db.prepare(sql).all()) as ScheduledEpisode[]

  if (rows.length === 0) return 0

  const update = db.prepare(
    "UPDATE episodes SET status = 'published', updated_at = datetime('now') WHERE id = ? AND status = 'scheduled'",
  )

  let flipped = 0
  for (const row of rows) {
    const result = update.run(row.id)
    // changes === 0 means another worker beat us to it; skip.
    if (result.changes === 0) continue

    logAudit({
      podcastId: row.podcast_id,
      userId: null, // system flip
      action: 'episode.publish',
      entityType: 'episode',
      entityId: row.id,
      summary: `Auto-published scheduled episode "${row.title || 'Untitled episode'}"`,
      details: { source: 'scheduler', published_at: row.published_at },
    })

    void firePublishEvent(row.podcast_id, row.id, 'episode-schedule', null)
      .catch((err) => {
        console.error('[scheduler] firePublishEvent failed', { episodeId: row.id, err })
      })
    flipped++
  }
  return flipped
}

/**
 * Find podcasts with auto-trigger on whose pending-changes window has been
 * quiet for >= PUBLISH_DEBOUNCE_MINUTES. Fire one consolidated dispatch per
 * podcast. Errors are logged and don't abort the loop. Returns the number
 * of dispatches actually attempted.
 */
export function processPendingPublishes(): number {
  const db = getDb()
  // Interpolating the constant integer is safe (it's our own typed value;
  // not user input) and lets us use SQLite's datetime() modifier syntax.
  const rows = db.prepare(`
    SELECT id, slug FROM podcasts
    WHERE github_auto_trigger = 1
      AND publish_dirty_last_at IS NOT NULL
      AND status = 'active'
      AND datetime(publish_dirty_last_at, '+${PUBLISH_DEBOUNCE_MINUTES} minutes') <= datetime('now')
  `).all() as { id: number; slug: string }[]

  let fired = 0
  for (const row of rows) {
    // Kill switch: skip the dispatch but leave dirty markers in place so
    // unpause can fire a normal debounced build off the accumulated changes.
    if (isDeploysPaused(row.id)) continue

    const config = loadGithubConfig(row.id)
    // Config got removed but auto_trigger is still on. Don't clear the
    // dirty flag — keep it so the UI banner can show "configure GitHub
    // and click Rebuild Now."
    if (!config) continue

    // Clear FIRST so a fast follow-up edit re-marks dirty after we send;
    // otherwise an edit during dispatch could be lost when we cleared.
    clearPublishDirty(row.id)

    void dispatchRepositoryEvent(config, {
      slug: row.slug,
      reason: 'podshelf:auto-debounced',
      podcast_id: row.id,
      fired_at: new Date().toISOString(),
    }).catch((err) => {
      console.error(`[scheduler] auto-publish dispatch failed for podcast ${row.id}: ${err?.message || err}`)
    })

    logAudit({
      podcastId: row.id,
      userId: null,
      action: 'podcast.github.auto-trigger',
      entityType: 'podcast',
      entityId: row.id,
      summary: `Auto-fired GitHub rebuild after ${PUBLISH_DEBOUNCE_MINUTES}-minute quiet period`,
    })
    fired++
  }
  return fired
}

let timerHandle: ReturnType<typeof setInterval> | null = null

/**
 * Start the in-process scheduler. Idempotent — safe to call multiple times
 * (e.g. in dev where the server reloads). The interval is 60s by default,
 * which is the granularity users will see for "scheduled at HH:MM" flips.
 */
export function startScheduler(intervalMs = 60_000) {
  if (timerHandle) return
  // Fire once immediately so server restart doesn't leave overdue episodes
  // (or pending publishes) sitting until the first interval tick.
  try {
    processScheduledFlips()
    processPendingPublishes()
  } catch (err) {
    console.error('[scheduler] initial run failed', err)
  }
  timerHandle = setInterval(() => {
    try {
      processScheduledFlips()
      processPendingPublishes()
    } catch (err) {
      console.error('[scheduler] tick failed', err)
    }
  }, intervalMs)
  // Don't keep the process alive just for the timer.
  if (typeof timerHandle.unref === 'function') timerHandle.unref()
}

export function stopScheduler() {
  if (timerHandle) {
    clearInterval(timerHandle)
    timerHandle = null
  }
}
