import { defineEventHandler, getRouterParam, createError, setResponseStatus } from 'h3'
import { requirePodcastAccess } from '../../../utils/auth'
import { logAudit } from '../../../utils/audit'
import getDb from '../../../db/index'

/**
 * DELETE /api/podcasts/[slug]
 *
 * Soft-delete: marks the podcast as inactive. The public RSS feed returns
 * 404 while inactive, but owners still see the podcast in their dashboard
 * marked "awaiting purge" and can restore it (POST /restore).
 * Permanent removal requires DELETE /api/podcasts/[slug]/purge (admin-only).
 */
export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { user, podcastId } = requirePodcastAccess(event, slug)
  const db = getDb()

  const existing = db.prepare('SELECT status, title FROM podcasts WHERE id = ?').get(podcastId) as { status: string; title: string } | undefined
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Podcast not found' })
  }

  db.prepare(`
    UPDATE podcasts
    SET status = 'inactive', deleted_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `).run(podcastId)

  logAudit(event, {
    podcastId,
    userId: user.id,
    action: 'podcast.delete',
    entityType: 'podcast',
    entityId: podcastId,
    summary: `Soft-deleted podcast "${existing.title}"`,
  })

  setResponseStatus(event, 204)
  return null
})
