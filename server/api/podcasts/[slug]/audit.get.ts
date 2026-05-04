import { defineEventHandler, getRouterParam, getQuery, createError } from 'h3'
import { requirePodcastAccess } from '../../../utils/auth'
import getDb from '../../../db/index'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

/**
 * GET /api/podcasts/[slug]/audit?limit=50&before=<id>
 *
 * Returns paginated audit log rows for the podcast, newest first. `before`
 * is the highest id from the previous page; rows with id < before are returned.
 */
export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { podcastId } = requirePodcastAccess(event, slug)

  const query = getQuery(event)
  let limit = Number(query.limit ?? DEFAULT_LIMIT)
  if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT_LIMIT
  if (limit > MAX_LIMIT) limit = MAX_LIMIT

  const before = query.before ? Number(query.before) : null
  if (before !== null && !Number.isFinite(before)) {
    throw createError({ statusCode: 400, statusMessage: 'before must be a number' })
  }

  const db = getDb()
  const sql = `
    SELECT a.id, a.podcast_id, a.user_id, a.action, a.entity_type, a.entity_id,
           a.summary, a.details, a.created_at,
           u.email AS user_email
    FROM audit_log a
    LEFT JOIN users u ON u.id = a.user_id
    WHERE a.podcast_id = ?
      ${before !== null ? 'AND a.id < ?' : ''}
    ORDER BY a.id DESC
    LIMIT ?
  `
  const params: (number | string | null)[] = [podcastId]
  if (before !== null) params.push(before)
  params.push(limit + 1) // fetch one extra to know if there's another page

  const rows = db.prepare(sql).all(...params) as Array<{
    id: number
    podcast_id: number | null
    user_id: number | null
    action: string
    entity_type: string | null
    entity_id: number | null
    summary: string | null
    details: string | null
    created_at: string
    user_email: string | null
  }>

  const hasMore = rows.length > limit
  const page = rows.slice(0, limit)

  return {
    entries: page.map((r) => ({
      ...r,
      details: r.details ? JSON.parse(r.details) : null,
    })),
    has_more: hasMore,
    next_before: hasMore ? page[page.length - 1].id : null,
  }
})
