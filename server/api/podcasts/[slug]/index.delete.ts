import { defineEventHandler, getRouterParam, createError, setResponseStatus } from 'h3'
import { requireAdmin } from '../../../utils/auth'
import getDb from '../../../db/index'

/**
 * DELETE /api/podcasts/[slug]
 *
 * Admin-only. Cascades to episodes, downloads, and memberships.
 */
export default defineEventHandler((event) => {
  requireAdmin(event)

  const slug = getRouterParam(event, 'slug') as string
  const db = getDb()

  const podcast = db.prepare('SELECT id FROM podcasts WHERE slug = ?').get(slug) as { id: number } | undefined
  if (!podcast) {
    throw createError({ statusCode: 404, statusMessage: 'Podcast not found' })
  }

  db.prepare('DELETE FROM podcasts WHERE id = ?').run(podcast.id)
  setResponseStatus(event, 204)
  return null
})
