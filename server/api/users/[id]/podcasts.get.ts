import { defineEventHandler, getRouterParam, createError } from 'h3'
import { requireAdmin } from '../../../utils/auth'
import getDb from '../../../db/index'

/**
 * GET /api/users/[id]/podcasts
 *
 * Admin-only. Lists podcasts this user is a member of.
 */
export default defineEventHandler((event) => {
  requireAdmin(event)

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id is required' })

  const db = getDb()
  return db.prepare(`
    SELECT p.id, p.slug, p.title, p.image_url, p.status, p.lifecycle, pu.created_at
    FROM podcast_users pu
    JOIN podcasts p ON p.id = pu.podcast_id
    WHERE pu.user_id = ?
    ORDER BY p.title
  `).all(id)
})
