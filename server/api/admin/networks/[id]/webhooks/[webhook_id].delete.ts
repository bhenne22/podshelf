import { defineEventHandler, getRouterParam, createError } from 'h3'
import { requireAdmin } from '../../../../../utils/auth'
import { deleteWebhook, getWebhookSummary } from '../../../../../utils/webhook'
import { logAudit } from '../../../../../utils/audit'

export default defineEventHandler((event) => {
  const user = requireAdmin(event)
  const networkId = Number(getRouterParam(event, 'id'))
  const id = Number(getRouterParam(event, 'webhook_id'))
  if (!Number.isFinite(networkId) || !Number.isFinite(id)) {
    throw createError({ statusCode: 400, statusMessage: 'network id + webhook id required' })
  }
  const existing = getWebhookSummary(id)
  if (!existing || existing.scope !== 'network' || existing.scope_id !== networkId) {
    throw createError({ statusCode: 404, statusMessage: 'Webhook not found' })
  }
  deleteWebhook(id)

  logAudit(event, {
    podcastId: null,
    userId: user.id,
    action: 'network.webhook.delete',
    entityType: 'network',
    entityId: networkId,
    summary: `Deleted network webhook #${id}${existing.name ? ` "${existing.name}"` : ''}`,
  })

  return { ok: true }
})
