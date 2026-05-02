import { defineEventHandler, getRouterParam, createError, setResponseStatus } from 'h3'
import { requireAdmin } from '../../../../utils/auth'
import getDb from '../../../../db/index'

/**
 * DELETE /api/podcasts/[slug]/members/[userId]
 *
 * Admin-only. Removes a user's access to the podcast.
 */
export default defineEventHandler((event) => {
  requireAdmin(event)

  const slug = getRouterParam(event, 'slug') as string
  const userId = getRouterParam(event, 'userId')

  if (!userId) {
    throw createError({ statusCode: 400, statusMessage: 'userId is required' })
  }

  const db = getDb()
  const podcast = db.prepare('SELECT id FROM podcasts WHERE slug = ?').get(slug) as { id: number } | undefined
  if (!podcast) {
    throw createError({ statusCode: 404, statusMessage: 'Podcast not found' })
  }

  db.prepare('DELETE FROM podcast_users WHERE podcast_id = ? AND user_id = ?').run(podcast.id, userId)
  setResponseStatus(event, 204)
  return null
})
