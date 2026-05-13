import { defineEventHandler, getRouterParam, readBody, createError } from 'h3'
import { requireAdmin } from '../../../../utils/auth'
import { logAudit } from '../../../../utils/audit'
import {
  PROPERTY_TYPES,
  isPropertyType,
  validatePropertyKey,
  type PropertyType,
} from '../../../../utils/network-properties'
import getDb from '../../../../db/index'

/**
 * POST /api/admin/networks/[id]/property-definitions
 *
 * Define a new custom property on a network. Body: { key, label, type,
 * required?, position? }. Default position goes to the end.
 */
export default defineEventHandler(async (event) => {
  const user = requireAdmin(event)
  const networkId = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(networkId)) {
    throw createError({ statusCode: 400, statusMessage: 'network id required' })
  }

  const db = getDb()
  const network = db.prepare('SELECT id, title FROM networks WHERE id = ?')
    .get(networkId) as { id: number; title: string } | undefined
  if (!network) {
    throw createError({ statusCode: 404, statusMessage: 'Network not found' })
  }

  const body = await readBody(event)
  const key = validatePropertyKey(body?.key)
  const label = String(body?.label ?? '').trim() || key
  const description = body?.description ? (String(body.description).trim() || null) : null
  if (!isPropertyType(body?.type)) {
    throw createError({
      statusCode: 400,
      statusMessage: `type must be one of: ${PROPERTY_TYPES.join(', ')}`,
    })
  }
  const type: PropertyType = body.type
  const required = body?.required ? 1 : 0

  if (db.prepare(
    'SELECT 1 FROM network_property_definitions WHERE network_id = ? AND key = ?'
  ).get(networkId, key)) {
    throw createError({
      statusCode: 409,
      statusMessage: `Property "${key}" is already defined on this network`,
    })
  }

  let position: number
  if (typeof body?.position === 'number' && Number.isFinite(body.position)) {
    position = body.position
  } else {
    const max = db.prepare(
      'SELECT COALESCE(MAX(position), -1) AS m FROM network_property_definitions WHERE network_id = ?'
    ).get(networkId) as { m: number }
    position = (max?.m ?? -1) + 1
  }

  const result = db.prepare(`
    INSERT INTO network_property_definitions (network_id, key, label, description, type, required, position)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(networkId, key, label, description, type, required, position)
  const id = Number(result.lastInsertRowid)

  logAudit(event, {
    podcastId: null,
    userId: user.id,
    action: 'network.property.define',
    entityType: 'network',
    entityId: networkId,
    summary: `Defined property "${key}" (${type}) on network "${network.title}"`,
  })

  event.node.res.statusCode = 201
  return db.prepare(
    'SELECT id, key, label, description, type, required, position, created_at, updated_at FROM network_property_definitions WHERE id = ?'
  ).get(id)
})
