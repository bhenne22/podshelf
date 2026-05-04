import { defineEventHandler, getRouterParam, createError, setResponseStatus } from 'h3'
import { requireAdmin } from '../../../../utils/auth'
import { logAudit } from '../../../../utils/audit'
import getDb from '../../../../db/index'

/**
 * DELETE /api/podcasts/[slug]/members/[userId]
 *
 * Admin-only. Removes a user's access to the podcast.
 */
export default defineEventHandler((event) => {
  const admin = requireAdmin(event)

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

  const u = db.prepare('SELECT email FROM users WHERE id = ?').get(userId) as { email: string } | undefined
  const result = db.prepare('DELETE FROM podcast_users WHERE podcast_id = ? AND user_id = ?').run(podcast.id, userId)

  if (result.changes > 0) {
    logAudit({
      podcastId: podcast.id,
      userId: admin.id,
      action: 'podcast.member.remove',
      entityType: 'user',
      entityId: Number(userId),
      summary: `Removed ${u?.email ?? `user ${userId}`} from podcast members`,
    })
  }

  setResponseStatus(event, 204)
  return null
})
