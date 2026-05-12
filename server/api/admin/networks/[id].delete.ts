import { defineEventHandler, getRouterParam, createError } from 'h3'
import { requireAdmin } from '../../../utils/auth'
import { logAudit } from '../../../utils/audit'
import getDb from '../../../db/index'

/**
 * DELETE /api/admin/networks/[id]
 *
 * Hard delete — cascades to network_podcasts. Podcasts and their members
 * are unaffected. There is no soft-delete for networks because nothing
 * downstream caches by network slug yet.
 */
export default defineEventHandler((event) => {
  const user = requireAdmin(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id)) {
    throw createError({ statusCode: 400, statusMessage: 'network id required' })
  }

  const db = getDb()
  const existing = db.prepare(
    'SELECT id, title, slug FROM networks WHERE id = ?'
  ).get(id) as { id: number; title: string; slug: string } | undefined
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Network not found' })
  }

  db.prepare('DELETE FROM networks WHERE id = ?').run(id)

  logAudit(event, {
    podcastId: null,
    userId: user.id,
    action: 'network.delete',
    entityType: 'network',
    entityId: id,
    summary: `Deleted network "${existing.title}" (slug ${existing.slug})`,
  })

  return { ok: true }
})
