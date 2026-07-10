import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../../utils/auth'
import { assertPublicHttpUrl } from '../../../../utils/ssrf'
import {
  createPodcastWebhook,
  getWebhookSummary,
  isWebhookEvent,
  isWebhookFormat,
  type WebhookEvent,
} from '../../../../utils/webhook'
import { logAudit } from '../../../../utils/audit'

/**
 * POST /api/podcasts/[slug]/webhooks
 *
 * Body: { name?, url, format, enabled?, events: string[] }
 *
 * Creates a new webhook attached to this podcast. `events` lists the event
 * names the webhook should fire for; an empty list creates an effectively
 * dormant webhook (useful while configuring before going live).
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { user, podcastId } = requirePodcastAccess(event, slug)

  const body = await readBody(event)
  const url = String(body?.url ?? '').trim()
  if (!url || !/^https?:\/\//i.test(url)) {
    throw createError({ statusCode: 400, statusMessage: 'url must start with http:// or https://' })
  }
  await assertPublicHttpUrl(url)
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

  const id = createPodcastWebhook(podcastId, {
    name: typeof body?.name === 'string' ? body.name : '',
    url,
    format: body.format,
    enabled: body?.enabled !== false,
    events,
  })

  logAudit(event, {
    podcastId,
    userId: user.id,
    action: 'podcast.webhook.create',
    entityType: 'webhook',
    entityId: id,
    summary: `Created webhook (${body.format}, ${events.length} event${events.length === 1 ? '' : 's'})`,
    details: { events, enabled: body?.enabled !== false },
  })

  event.node.res.statusCode = 201
  return getWebhookSummary(id)
})
