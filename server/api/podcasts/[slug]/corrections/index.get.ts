import { defineEventHandler, getRouterParam, getQuery, createError } from 'h3'
import { requirePodcastAccess } from '../../../../utils/auth'
import { isCorrectionStatus } from '../../../../utils/correction'
import getDb from '../../../../db/index'

/**
 * GET /api/podcasts/[slug]/corrections?status=new
 *
 * Listener-submitted corrections for triage, newest first. Membership
 * required — submissions can carry a contact address, so this is never a
 * public read.
 *
 * `ip_hash` and `user_agent` are deliberately not projected; they exist for
 * rate limiting, not for the hosts to browse.
 */
export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { podcastId } = requirePodcastAccess(event, slug)

  const query = getQuery(event)
  const status = query.status ? String(query.status) : null
  if (status && status !== 'all' && !isCorrectionStatus(status)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid status filter' })
  }

  const db = getDb()
  const where = status && status !== 'all'
    ? 'c.podcast_id = ? AND c.status = ?'
    : 'c.podcast_id = ?'
  const params = status && status !== 'all' ? [podcastId, status] : [podcastId]

  return db.prepare(`
    SELECT c.id, c.episode_id, c.episode_slug, c.timecode, c.claim,
           c.correction, c.source_url, c.submitter_name, c.submitter_contact,
           c.status, c.resolution_note, c.aired_episode_id,
           c.created_at, c.updated_at,
           e.title AS episode_title,
           a.title AS aired_episode_title
    FROM corrections c
    LEFT JOIN episodes e ON e.id = c.episode_id
    LEFT JOIN episodes a ON a.id = c.aired_episode_id
    WHERE ${where}
    ORDER BY c.id DESC
  `).all(...params)
})
