import { defineEventHandler, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../../utils/auth'
import { logAudit } from '../../../../utils/audit'
import getDb from '../../../../db/index'

/**
 * DELETE /api/podcasts/[slug]/distribution/[id]
 *
 * Removes one destination. Position gaps are harmless — the list orders by
 * position ASC and the next reorder rewrites every row's position anyway.
 */
export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug') as string
  const id = Number(getRouterParam(event, 'id'))
  const { user, podcastId } = requirePodcastAccess(event, slug)

  if (!Number.isFinite(id)) {
    throw createError({ statusCode: 400, statusMessage: 'distribution id required' })
  }

  const db = getDb()
  const existing = db.prepare(
    'SELECT id, name FROM podcast_distributions WHERE id = ? AND podcast_id = ?'
  ).get(id, podcastId) as { id: number; name: string } | undefined
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Distribution not found' })
  }

  db.prepare('DELETE FROM podcast_distributions WHERE id = ?').run(id)

  logAudit({
    podcastId,
    userId: user.id,
    action: 'distribution.delete',
    entityType: 'distribution',
    entityId: id,
    summary: `Removed "${existing.name}" from distribution list`,
  })

  return { ok: true }
})
