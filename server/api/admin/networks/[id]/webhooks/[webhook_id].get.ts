import { defineEventHandler, getRouterParam, createError } from 'h3'
import { requireAdmin } from '../../../../../utils/auth'
import { getWebhookSummary } from '../../../../../utils/webhook'

export default defineEventHandler((event) => {
  requireAdmin(event)
  const networkId = Number(getRouterParam(event, 'id'))
  const id = Number(getRouterParam(event, 'webhook_id'))
  if (!Number.isFinite(networkId) || !Number.isFinite(id)) {
    throw createError({ statusCode: 400, statusMessage: 'network id + webhook id required' })
  }
  const wh = getWebhookSummary(id)
  if (!wh || wh.scope !== 'network' || wh.scope_id !== networkId) {
    throw createError({ statusCode: 404, statusMessage: 'Webhook not found' })
  }
  return wh
})
