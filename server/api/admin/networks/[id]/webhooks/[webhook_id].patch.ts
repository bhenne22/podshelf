import { defineEventHandler, getRouterParam, readBody, createError } from 'h3'
import { requireAdmin } from '../../../../../utils/auth'
import {
  getWebhookSummary,
  isWebhookEvent,
  isWebhookFormat,
  updateWebhook,
  type UpdateWebhookInput,
  type WebhookEvent,
} from '../../../../../utils/webhook'
import { logAudit } from '../../../../../utils/audit'

export default defineEventHandler(async (event) => {
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

  const body = await readBody(event)
  const patch: UpdateWebhookInput = {}

  if ('name' in body) patch.name = String(body.name ?? '')
  if ('url' in body) {
    const url = String(body.url ?? '').trim()
    if (url) {
      if (!/^https?:\/\//i.test(url)) {
        throw createError({ statusCode: 400, statusMessage: 'url must start with http:// or https://' })
      }
      patch.url = url
    }
  }
  if ('format' in body) {
    if (!isWebhookFormat(body.format)) {
      throw createError({ statusCode: 400, statusMessage: 'format must be discord, slack, or generic' })
    }
    patch.format = body.format
  }
  if ('enabled' in body) patch.enabled = !!body.enabled
  if ('events' in body) {
    if (!Array.isArray(body.events)) {
      throw createError({ statusCode: 400, statusMessage: 'events must be an array of event names' })
    }
    const events: WebhookEvent[] = []
    for (const e of body.events) {
      if (!isWebhookEvent(e)) {
        throw createError({ statusCode: 400, statusMessage: `unknown event "${String(e)}"` })
      }
      events.push(e)
    }
    patch.events = events
  }

  updateWebhook(id, patch)

  logAudit(event, {
    podcastId: null,
    userId: user.id,
    action: 'network.webhook.update',
    entityType: 'network',
    entityId: networkId,
    summary: `Updated network webhook #${id}`,
    details: { webhook_id: id, fields: Object.keys(patch) },
  })

  return getWebhookSummary(id)
})
