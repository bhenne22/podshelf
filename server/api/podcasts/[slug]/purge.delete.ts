import { defineEventHandler, getRouterParam, createError, setResponseStatus } from 'h3'
import { requireAdmin } from '../../../utils/auth'
import { logAudit } from '../../../utils/audit'
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
  const admin = requireAdmin(event)

  const slug = getRouterParam(event, 'slug') as string
  const db = getDb()

  const podcast = db.prepare('SELECT id, status, title FROM podcasts WHERE slug = ?').get(slug) as { id: number; status: string; title: string } | undefined
  if (!podcast) {
    throw createError({ statusCode: 404, statusMessage: 'Podcast not found' })
  }
  if (podcast.status !== 'inactive') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Podcast must be soft-deleted (inactive) before it can be purged',
    })
  }

  // Log BEFORE delete — the audit row's podcast_id FK cascades on delete,
  // so post-delete logging would orphan the entry.
  logAudit(event, {
    podcastId: null,
    userId: admin.id,
    action: 'podcast.purge',
    entityType: 'podcast',
    entityId: podcast.id,
    summary: `Permanently purged podcast "${podcast.title}" (slug ${slug})`,
  })

  db.prepare('DELETE FROM podcasts WHERE id = ?').run(podcast.id)
  setResponseStatus(event, 204)
  return null
})
