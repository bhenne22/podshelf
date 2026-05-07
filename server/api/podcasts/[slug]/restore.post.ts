import { defineEventHandler, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../utils/auth'
import { logAudit } from '../../../utils/audit'
import getDb from '../../../db/index'

/**
 * POST /api/podcasts/[slug]/restore
 *
 * Reverses a soft-delete. Allowed for any podcast member (owners + admin).
 */
export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { user, podcastId } = requirePodcastAccess(event, slug)
  const db = getDb()

  const existing = db.prepare('SELECT status, title FROM podcasts WHERE id = ?').get(podcastId) as { status: string; title: string } | undefined
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Podcast not found' })
  }
  if (existing.status === 'active') {
    return { ok: true, alreadyActive: true }
  }

  db.prepare(`
    UPDATE podcasts
    SET status = 'active', deleted_at = NULL, updated_at = datetime('now')
    WHERE id = ?
  `).run(podcastId)

  logAudit(event, {
    podcastId,
    userId: user.id,
    action: 'podcast.restore',
    entityType: 'podcast',
    entityId: podcastId,
    summary: `Restored podcast "${existing.title}"`,
  })

  return { ok: true }
})
