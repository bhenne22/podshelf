import { defineEventHandler, getRouterParam, readBody, createError } from 'h3'
import { requireAdmin } from '../../../../../../../utils/auth'
import { logAudit } from '../../../../../../../utils/audit'
import {
  normalizePropertyValue,
  type PropertyType,
} from '../../../../../../../utils/network-properties'
import getDb from '../../../../../../../db/index'

/**
 * PUT /api/admin/networks/[id]/podcasts/[podcast_id]/properties/[key]
 *
 * Set a value for one (network, podcast, key) cell. Validates the value
 * against the property definition's type. 404 if the def doesn't exist or
 * the podcast isn't a member of the network.
 */
export default defineEventHandler(async (event) => {
  const user = requireAdmin(event)
  const networkId = Number(getRouterParam(event, 'id'))
  const podcastId = Number(getRouterParam(event, 'podcast_id'))
  const key = getRouterParam(event, 'key') as string
  if (!Number.isFinite(networkId) || !Number.isFinite(podcastId) || !key) {
    throw createError({ statusCode: 400, statusMessage: 'network id, podcast id, and key required' })
  }

  const db = getDb()
  const def = db.prepare(
    'SELECT type FROM network_property_definitions WHERE network_id = ? AND key = ?'
  ).get(networkId, key) as { type: string } | undefined
  if (!def) {
    throw createError({ statusCode: 404, statusMessage: 'Property is not defined on this network' })
  }

  const membership = db.prepare(
    'SELECT 1 FROM network_podcasts WHERE network_id = ? AND podcast_id = ?'
  ).get(networkId, podcastId)
  if (!membership) {
    throw createError({ statusCode: 404, statusMessage: 'Podcast is not in this network' })
  }

  const body = await readBody(event)
  const normalized = normalizePropertyValue(def.type as PropertyType, body?.value)
  if (normalized === null) {
    throw createError({
      statusCode: 400,
      statusMessage: 'value cannot be blank — use DELETE to clear instead',
    })
  }

  db.prepare(`
    INSERT INTO network_podcast_properties (network_id, podcast_id, key, value, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(network_id, podcast_id, key) DO UPDATE
      SET value = excluded.value, updated_at = datetime('now')
  `).run(networkId, podcastId, key, normalized)

  logAudit(event, {
    podcastId,
    userId: user.id,
    action: 'network.property.value.set',
    entityType: 'network',
    entityId: networkId,
    summary: `Set ${key} = ${normalized}`,
  })

  return { key, value: normalized, type: def.type }
})
