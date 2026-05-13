import { defineEventHandler, getRouterParam, createError } from 'h3'
import { requireAdmin } from '../../../../../../../utils/auth'
import { logAudit } from '../../../../../../../utils/audit'
import getDb from '../../../../../../../db/index'

/**
 * DELETE /api/admin/networks/[id]/podcasts/[podcast_id]/properties/[key]
 *
 * Clear one value cell. No-op (still 200) if the row didn't exist — the
 * end state matches the intent either way.
 */
export default defineEventHandler((event) => {
  const user = requireAdmin(event)
  const networkId = Number(getRouterParam(event, 'id'))
  const podcastId = Number(getRouterParam(event, 'podcast_id'))
  const key = getRouterParam(event, 'key') as string
  if (!Number.isFinite(networkId) || !Number.isFinite(podcastId) || !key) {
    throw createError({ statusCode: 400, statusMessage: 'network id, podcast id, and key required' })
  }

  const db = getDb()
  const result = db.prepare(
    'DELETE FROM network_podcast_properties WHERE network_id = ? AND podcast_id = ? AND key = ?'
  ).run(networkId, podcastId, key)

  if (result.changes > 0) {
    logAudit(event, {
      podcastId,
      userId: user.id,
      action: 'network.property.value.clear',
      entityType: 'network',
      entityId: networkId,
      summary: `Cleared ${key}`,
    })
  }

  return { ok: true }
})
