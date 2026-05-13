import { defineEventHandler, getRouterParam, createError } from 'h3'
import { requireAdmin } from '../../../../utils/auth'
import getDb from '../../../../db/index'

/**
 * GET /api/admin/networks/[id]/property-definitions
 *
 * Admin mirror of the public list — used by the admin network edit page so
 * the call lives entirely under /api/admin/ for consistency with the rest
 * of the admin network surface.
 */
export default defineEventHandler((event) => {
  requireAdmin(event)
  const networkId = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(networkId)) {
    throw createError({ statusCode: 400, statusMessage: 'network id required' })
  }
  const db = getDb()
  return db.prepare(`
    SELECT id, key, label, description, type, required, position, created_at, updated_at
    FROM network_property_definitions
    WHERE network_id = ?
    ORDER BY position, key
  `).all(networkId)
})
