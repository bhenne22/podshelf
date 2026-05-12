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

  const db = getDb()

  let excludePodcastId: number | null = null
  if (query.excludePodcast) {
    const row = db.prepare('SELECT id FROM podcasts WHERE slug = ?')
      .get(String(query.excludePodcast)) as { id: number } | undefined
    excludePodcastId = row?.id ?? null
  }

  const placeholders = effectivePodcastIds.map(() => '?').join(',')
  const params: (string | number)[] = [...effectivePodcastIds, from, to]

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
    FROM episodes e
    JOIN podcasts p ON p.id = e.podcast_id
    WHERE e.podcast_id IN (${placeholders})
      AND e.status IN ('scheduled','published')
      AND e.published_at IS NOT NULL
      AND e.published_at BETWEEN ? AND ?
  `
  if (excludePodcastId !== null) {
    sql += ' AND e.podcast_id != ?'
    params.push(excludePodcastId)
  }
  sql += ' ORDER BY e.published_at ASC'

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
