import { defineEventHandler, getRouterParam, createError } from 'h3'
import { requireAdmin } from '../../../../../utils/auth'
import { logAudit } from '../../../../../utils/audit'
import getDb from '../../../../../db/index'

/**
 * DELETE /api/admin/networks/[id]/property-definitions/[key]
 *
 * Drops a property definition AND all of its stored values across the
 * network's roster. The value table references the def by string key, not
 * by FK to the def row, so we do the cascade in app code (one transaction).
 */
export default defineEventHandler((event) => {
  const user = requireAdmin(event)
  const networkId = Number(getRouterParam(event, 'id'))
  const key = getRouterParam(event, 'key') as string
  if (!Number.isFinite(networkId) || !key) {
    throw createError({ statusCode: 400, statusMessage: 'network id and key required' })
  }

  const db = getDb()
  const existing = db.prepare(
    'SELECT id FROM network_property_definitions WHERE network_id = ? AND key = ?'
  ).get(networkId, key) as { id: number } | undefined
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Property not found' })
  }

  const tx = db.transaction(() => {
    const valuesResult = db.prepare(
      'DELETE FROM network_podcast_properties WHERE network_id = ? AND key = ?'
    ).run(networkId, key)
    db.prepare(
      'DELETE FROM network_property_definitions WHERE id = ?'
    ).run(existing.id)
    return valuesResult.changes
  })
  const valuesCleared = tx()

  logAudit(event, {
    podcastId: null,
    userId: user.id,
    action: 'network.property.delete',
    entityType: 'network',
    entityId: networkId,
    summary: `Deleted property "${key}" (cleared ${valuesCleared} values)`,
    details: { values_cleared: valuesCleared },
  })

  return { ok: true, values_cleared: valuesCleared }
})
