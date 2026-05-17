import { defineEventHandler, getRouterParam, getQuery, createError } from 'h3'
import { requireNetworkReadAccess } from '../../../utils/auth'
import getDb from '../../../db/index'

/**
 * GET /api/networks/[slug]/upcoming-episodes
 *
 * Aggregated upcoming/recently-published episodes across the network's
 * podcasts, used by the network dashboard timeline and by the inline
 * scheduling conflict hint. Drafts are always excluded.
 *
 * Query params:
 *   from           ISO datetime, default now
 *   to             ISO datetime, default now + 60 days
 *   excludePodcast podcast slug to omit (the host's own show, when used
 *                  by the inline hint)
 *   include        Comma-separated. "recording" widens the WHERE to also
 *                  include episodes whose recording_starts_at falls in
 *                  the window, and projects recording_starts_at +
 *                  recording_duration_minutes. Off by default so the
 *                  NetworkConflictHint callsite (which only cares about
 *                  publish-date collisions) keeps its narrower payload.
 *
 * A scoped API key only sees the intersection of its scope with the
 * network — a key can never widen its data view via this endpoint.
 */
export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { effectivePodcastIds } = requireNetworkReadAccess(event, slug)

  if (effectivePodcastIds.length === 0) return { episodes: [] }

  const query = getQuery(event)
  const now = new Date()
  const fromRaw = query.from ? String(query.from) : now.toISOString()
  const toRaw = query.to
    ? String(query.to)
    : new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString()
  const from = parseDate(fromRaw, 'from')
  const to = parseDate(toRaw, 'to')

  const includeRecording = (() => {
    if (!query.include) return false
    const tokens = String(query.include).split(',').map((s) => s.trim().toLowerCase())
    return tokens.includes('recording')
  })()

  const db = getDb()

  let excludePodcastId: number | null = null
  if (query.excludePodcast) {
    const row = db.prepare('SELECT id FROM podcasts WHERE slug = ?')
      .get(String(query.excludePodcast)) as { id: number } | undefined
    excludePodcastId = row?.id ?? null
  }

  const placeholders = effectivePodcastIds.map(() => '?').join(',')
  const recordingProjection = includeRecording
    ? `, e.recording_starts_at, e.recording_duration_minutes`
    : ''

  const params: (string | number)[] = [...effectivePodcastIds]
  let dateFilter: string
  if (includeRecording) {
    // Include episodes whose recording slot falls in the window even if
    // the publish date is outside (or null). Status filter still applies
    // ONLY to the publish-date branch — a draft with a recording slot
    // should still show up as a recording event on the timeline.
    dateFilter = `(
      (e.status IN ('scheduled','published')
         AND e.published_at IS NOT NULL
         AND e.published_at BETWEEN ? AND ?)
      OR (e.recording_starts_at IS NOT NULL
            AND e.recording_starts_at BETWEEN ? AND ?)
    )`
    params.push(from, to, from, to)
  } else {
    dateFilter = `e.status IN ('scheduled','published')
                  AND e.published_at IS NOT NULL
                  AND e.published_at BETWEEN ? AND ?`
    params.push(from, to)
  }

  let sql = `
    SELECT e.id AS episode_id,
           e.title AS episode_title,
           e.slug AS episode_slug,
           e.status,
           e.published_at,
           e.episode_type,
           p.id AS podcast_id,
           p.slug AS podcast_slug,
           p.title AS podcast_title,
           p.image_url AS podcast_image_url,
           p.timezone AS podcast_timezone
           ${recordingProjection}
    FROM episodes e
    JOIN podcasts p ON p.id = e.podcast_id
    WHERE e.podcast_id IN (${placeholders})
      AND ${dateFilter}
  `
  if (excludePodcastId !== null) {
    sql += ' AND e.podcast_id != ?'
    params.push(excludePodcastId)
  }
  // Sort by whichever timestamp the row actually carries — falls back to
  // recording_starts_at when there's no publish date, so the page can
  // chronologically interleave events without doing it client-side.
  sql += ` ORDER BY COALESCE(e.published_at, e.recording_starts_at) ASC`

  const episodes = db.prepare(sql).all(...params)
  return { episodes }
})

function parseDate(value: string, name: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) {
    throw createError({ statusCode: 400, statusMessage: `${name} is not a valid ISO date` })
  }
  return d.toISOString()
}
