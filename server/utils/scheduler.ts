import getDb from '../db/index'
import { firePublishEvent } from './publish-event'
import { logAudit } from './audit'

interface ScheduledEpisode {
  id: number
  podcast_id: number
  title: string
  published_at: string
}

/**
 * Decide whether a (status, published_at) pair should be coerced to
 * 'scheduled' on save. Returns the effective status to persist.
 *
 * Rule: status='published' + published_at strictly in the future → scheduled.
 * Anything else passes through.
 */
export function coerceScheduledStatus(
  desiredStatus: string | null | undefined,
  publishedAt: string | null | undefined,
): string | null | undefined {
  if (desiredStatus !== 'published') return desiredStatus
  if (!publishedAt) return desiredStatus
  const t = new Date(publishedAt).getTime()
  if (!Number.isFinite(t)) return desiredStatus
  if (t > Date.now()) return 'scheduled'
  return desiredStatus
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
  const sql = podcastId
    ? `SELECT id, podcast_id, title, published_at FROM episodes
       WHERE podcast_id = ? AND status = 'scheduled'
         AND published_at IS NOT NULL AND published_at <= datetime('now')`
    : `SELECT id, podcast_id, title, published_at FROM episodes
       WHERE status = 'scheduled'
         AND published_at IS NOT NULL AND published_at <= datetime('now')`
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
      summary: `Auto-published scheduled episode "${row.title}"`,
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

let timerHandle: ReturnType<typeof setInterval> | null = null

/**
 * Start the in-process scheduler. Idempotent — safe to call multiple times
 * (e.g. in dev where the server reloads). The interval is 60s by default,
 * which is the granularity users will see for "scheduled at HH:MM" flips.
 */
export function startScheduler(intervalMs = 60_000) {
  if (timerHandle) return
  // Fire once immediately so server restart doesn't leave overdue episodes
  // sitting until the first interval tick.
  try {
    processScheduledFlips()
  } catch (err) {
    console.error('[scheduler] initial run failed', err)
  }
  timerHandle = setInterval(() => {
    try {
      processScheduledFlips()
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
