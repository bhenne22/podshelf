import { defineEventHandler, getRouterParam, getQuery, createError } from 'h3'
import { requireNetworkReadAccess } from '../../../utils/auth'
import getDb from '../../../db/index'

/**
 * GET /api/networks/[slug]/episodes
 *
 * Flat episode list across every podcast in the network, newest first.
 *
 * This is the "which episode is 975?" lookup. Episode ids are global across
 * podcasts and, until now, only visible in an episode-page URL — so an id
 * quoted anywhere else (a log line, a webhook payload, a conversation) could
 * not be resolved back to an episode without opening podcasts one at a time.
 *
 * Distinct from upcoming-episodes.get.ts, which answers a different question:
 * that one is a date-windowed timeline for the dashboard and deliberately
 * excludes drafts. This one is the whole back catalogue, drafts included,
 * paged and searchable.
 *
 * Query params:
 *   q        substring match on episode title, or an exact episode id when
 *            the term is all digits
 *   podcast  podcast slug, to narrow to one show
 *   status   draft | scheduled | published
 *   limit    default 100, max 500
 *   offset   default 0
 *
 * A scoped API key only sees the intersection of its scope with the network —
 * a key can never widen its data view through this endpoint.
 */

// Pinned so a regression is caught by test/network-episodes-endpoint.test.ts
// rather than in prod. `id` is the whole point of the endpoint.
export const SELECT_COLS = `
  e.id AS episode_id,
  e.title AS episode_title,
  e.slug AS episode_slug,
  e.status,
  e.published_at,
  e.season_number,
  e.episode_number,
  e.episode_type,
  e.recording_starts_at,
  p.id AS podcast_id,
  p.slug AS podcast_slug,
  p.title AS podcast_title,
  p.image_url AS podcast_image_url,
  p.timezone AS podcast_timezone
`

const VALID_STATUSES = ['draft', 'scheduled', 'published']

export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { effectivePodcastIds } = requireNetworkReadAccess(event, slug)

  if (effectivePodcastIds.length === 0) {
    return { episodes: [], total: 0, limit: 0, offset: 0 }
  }

  const query = getQuery(event)
  const db = getDb()

  const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 500)
  const offset = Math.max(Number(query.offset) || 0, 0)

  const where: string[] = [`e.podcast_id IN (${effectivePodcastIds.map(() => '?').join(',')})`]
  const params: (string | number)[] = [...effectivePodcastIds]

  if (query.podcast) {
    const row = db.prepare('SELECT id FROM podcasts WHERE slug = ?')
      .get(String(query.podcast)) as { id: number } | undefined
    // An unknown slug, or one outside the network, must return nothing rather
    // than silently widening to the whole network.
    if (!row || !effectivePodcastIds.includes(row.id)) {
      return { episodes: [], total: 0, limit, offset }
    }
    where.push('e.podcast_id = ?')
    params.push(row.id)
  }

  if (query.status) {
    const status = String(query.status)
    if (!VALID_STATUSES.includes(status)) {
      throw createError({
        statusCode: 400,
        statusMessage: `status must be one of ${VALID_STATUSES.join(', ')}`,
      })
    }
    where.push('e.status = ?')
    params.push(status)
  }

  // A bare number is almost always someone pasting an episode id, so match the
  // id exactly *and* the title — "147" should still find "SI #147". But the id
  // hit has to come first: searching "1" matches 42 titles containing the
  // digit, which would bury the one row the caller actually asked for.
  let exactId: number | null = null
  if (query.q) {
    const term = String(query.q).trim()
    if (term) {
      if (/^\d+$/.test(term)) {
        exactId = Number(term)
        where.push('(e.id = ? OR e.title LIKE ?)')
        params.push(exactId, `%${term}%`)
      } else {
        where.push('e.title LIKE ?')
        params.push(`%${term}%`)
      }
    }
  }

  const whereSql = where.join(' AND ')

  const total = (db.prepare(
    `SELECT COUNT(*) AS n FROM episodes e WHERE ${whereSql}`,
  ).get(...params) as { n: number }).n

  // Ordering params sit between the WHERE params and LIMIT/OFFSET, and are
  // deliberately not part of the COUNT query above.
  const orderParams: number[] = []
  let idRank = ''
  if (exactId !== null) {
    idRank = 'CASE WHEN e.id = ? THEN 0 ELSE 1 END,'
    orderParams.push(exactId)
  }

  const episodes = db.prepare(`
    SELECT ${SELECT_COLS}
    FROM episodes e
    JOIN podcasts p ON p.id = e.podcast_id
    WHERE ${whereSql}
    ORDER BY
      ${idRank}
      COALESCE(e.published_at, e.recording_starts_at, e.created_at) DESC,
      e.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, ...orderParams, limit, offset)

  return { episodes, total, limit, offset }
})
