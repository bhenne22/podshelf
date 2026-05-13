import { defineEventHandler, getRouterParam, readBody, createError } from 'h3'
import { requireAdmin } from '../../../../../utils/auth'
import { logAudit, diffFields, summarizeChanges } from '../../../../../utils/audit'
import {
  PROPERTY_TYPES,
  isPropertyType,
  findUncoercible,
  type PropertyType,
} from '../../../../../utils/network-properties'
import getDb from '../../../../../db/index'

/**
 * PATCH /api/admin/networks/[id]/property-definitions/[key]
 *
 * Update a property definition. When `type` changes, every existing value
 * for the property must coerce cleanly under the new type — otherwise the
 * request 409s with the offending value so the admin can resolve the
 * conflict rather than silently breaking downstream consumers.
 */
export default defineEventHandler(async (event) => {
  const user = requireAdmin(event)
  const networkId = Number(getRouterParam(event, 'id'))
  const key = getRouterParam(event, 'key') as string
  if (!Number.isFinite(networkId) || !key) {
    throw createError({ statusCode: 400, statusMessage: 'network id and key required' })
  }

  const db = getDb()
  const existing = db.prepare(`
    SELECT id, key, label, description, type, required, position
    FROM network_property_definitions
    WHERE network_id = ? AND key = ?
  `).get(networkId, key) as {
    id: number; key: string; label: string; description: string | null;
    type: string; required: number; position: number;
  } | undefined
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Property not found' })
  }

  const body = await readBody(event)
  const updates: string[] = []
  const values: Record<string, unknown> = { id: existing.id }

  if ('label' in body) {
    const next = String(body.label ?? '').trim()
    if (!next) throw createError({ statusCode: 400, statusMessage: 'label cannot be blank' })
    values.label = next
    updates.push('label = @label')
  }

  if ('description' in body) {
    values.description = body.description == null
      ? null
      : (String(body.description).trim() || null)
    updates.push('description = @description')
  }

  if ('type' in body) {
    if (!isPropertyType(body.type)) {
      throw createError({
        statusCode: 400,
        statusMessage: `type must be one of: ${PROPERTY_TYPES.join(', ')}`,
      })
    }
    const nextType: PropertyType = body.type
    if (nextType !== existing.type) {
      const valueRows = db.prepare(
        'SELECT value FROM network_podcast_properties WHERE network_id = ? AND key = ?'
      ).all(networkId, key) as { value: string | null }[]
      const bad = findUncoercible(valueRows.map((r) => r.value), nextType)
      if (bad !== null) {
        throw createError({
          statusCode: 409,
          statusMessage:
            `Cannot change type to "${nextType}" — existing value "${bad}" cannot be coerced. ` +
            `Edit or clear the offending value first.`,
        })
      }
    }
    values.type = nextType
    updates.push('type = @type')
  }

  if ('required' in body) {
    values.required = body.required ? 1 : 0
    updates.push('required = @required')
  }

  if ('position' in body) {
    if (typeof body.position !== 'number' || !Number.isFinite(body.position)) {
      throw createError({ statusCode: 400, statusMessage: 'position must be a number' })
    }
    values.position = body.position
    updates.push('position = @position')
  }

  if (!updates.length) {
    throw createError({ statusCode: 400, statusMessage: 'No valid fields to update' })
  }

  updates.push(`updated_at = datetime('now')`)
  db.prepare(
    `UPDATE network_property_definitions SET ${updates.join(', ')} WHERE id = @id`
  ).run(values)

  const after = db.prepare(`
    SELECT key, label, description, type, required, position FROM network_property_definitions WHERE id = ?
  `).get(existing.id) as Record<string, unknown>

  const diff = diffFields(
    {
      label: existing.label,
      description: existing.description,
      type: existing.type,
      required: existing.required,
      position: existing.position,
    },
    after,
  )
  if (diff.changed.length > 0) {
    logAudit(event, {
      podcastId: null,
      userId: user.id,
      action: 'network.property.update',
      entityType: 'network',
      entityId: networkId,
      summary: summarizeChanges(`Updated property "${key}"`, diff.changed),
      details: diff,
    })
  }

  return db.prepare(
    'SELECT id, key, label, description, type, required, position, created_at, updated_at FROM network_property_definitions WHERE id = ?'
  ).get(existing.id)
})
