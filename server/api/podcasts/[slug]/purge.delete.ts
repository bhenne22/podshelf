import { defineEventHandler, getRouterParam, createError, setResponseStatus } from 'h3'
import { requireAdmin } from '../../../utils/auth'
import getDb from '../../../db/index'

/**
 * DELETE /api/podcasts/[slug]/purge
 *
 * Permanently removes the podcast and cascades to episodes, downloads,
 * memberships, and api-key scopes. Admin-only. Requires the podcast to
 * already be soft-deleted (status='inactive') to avoid accidental purges
 * of live podcasts.
 */
export default defineEventHandler((event) => {
  requireAdmin(event)

  const slug = getRouterParam(event, 'slug') as string
  const db = getDb()

  const podcast = db.prepare('SELECT id, status FROM podcasts WHERE slug = ?').get(slug) as { id: number; status: string } | undefined
  if (!podcast) {
    throw createError({ statusCode: 404, statusMessage: 'Podcast not found' })
  }
  if (podcast.status !== 'inactive') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Podcast must be soft-deleted (inactive) before it can be purged',
    })
  }

  db.prepare('DELETE FROM podcasts WHERE id = ?').run(podcast.id)
  setResponseStatus(event, 204)
  return null
})
