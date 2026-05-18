import { defineEventHandler, getRouterParam, createError } from 'h3'
import { requireAdmin } from '../../../../../utils/auth'
import { listNetworkWebhooks } from '../../../../../utils/webhook'
import getDb from '../../../../../db/index'

/**
 * GET /api/admin/networks/[id]/webhooks
 *
 * Redacted list of webhooks attached to this network. Admin-only.
 */
export default defineEventHandler((event) => {
  requireAdmin(event)
  const networkId = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(networkId)) {
    throw createError({ statusCode: 400, statusMessage: 'network id required' })
  }
  const db = getDb()
  const exists = db.prepare('SELECT 1 FROM networks WHERE id = ?').get(networkId)
  if (!exists) {
    throw createError({ statusCode: 404, statusMessage: 'Network not found' })
  }
  return listNetworkWebhooks(networkId)
})
