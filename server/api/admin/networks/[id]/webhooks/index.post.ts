import { defineEventHandler, getRouterParam, readBody, createError } from 'h3'
import { requireAdmin } from '../../../../../utils/auth'
import {
  createNetworkWebhook,
  getWebhookSummary,
  isWebhookEvent,
  isWebhookFormat,
  type WebhookEvent,
} from '../../../../../utils/webhook'
import { logAudit } from '../../../../../utils/audit'
import getDb from '../../../../../db/index'

/**
 * POST /api/admin/networks/[id]/webhooks
 *
 * Body: { name?, url, format, enabled?, events: string[] }.
 * Network-scoped webhooks fan out across every podcast in the network when
 * the matching event fires.
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
  const url = String(body?.url ?? '').trim()
  if (!url || !/^https?:\/\//i.test(url)) {
    throw createError({ statusCode: 400, statusMessage: 'url must start with http:// or https://' })
  }
  if (!isWebhookFormat(body?.format)) {
    throw createError({ statusCode: 400, statusMessage: 'format must be discord, slack, or generic' })
  }
  const eventsInput = Array.isArray(body?.events) ? body.events : []
  const events: WebhookEvent[] = []
  for (const e of eventsInput) {
    if (!isWebhookEvent(e)) {
      throw createError({ statusCode: 400, statusMessage: `unknown event "${String(e)}"` })
    }
    events.push(e)
  }

  const id = createNetworkWebhook(networkId, {
    name: typeof body?.name === 'string' ? body.name : '',
    url,
    format: body.format,
    enabled: body?.enabled !== false,
    events,
  })

  logAudit(event, {
    podcastId: null,
    userId: user.id,
    action: 'network.webhook.create',
    entityType: 'network',
    entityId: networkId,
    summary: `Created webhook on network "${network.title}" (${body.format}, ${events.length} event${events.length === 1 ? '' : 's'})`,
    details: { webhook_id: id, events, enabled: body?.enabled !== false },
  })

  event.node.res.statusCode = 201
  return getWebhookSummary(id)
})
