import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../../utils/auth'
import {
  getWebhookSummary,
  isWebhookEvent,
  isWebhookFormat,
  updateWebhook,
  type UpdateWebhookInput,
  type WebhookEvent,
} from '../../../../utils/webhook'
import { logAudit } from '../../../../utils/audit'

/**
 * PATCH /api/podcasts/[slug]/webhooks/[id]
 *
 * Body fields are all optional; any omitted field is left as-is. URL is
 * write-only — sending a new value rotates it, omitting keeps the previous
 * encrypted URL on file.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { user, podcastId } = requirePodcastAccess(event, slug)

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id)) {
    throw createError({ statusCode: 400, statusMessage: 'webhook id required' })
  }
  const existing = getWebhookSummary(id)
  if (!existing || existing.scope !== 'podcast' || existing.scope_id !== podcastId) {
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
    // Empty URL is ignored — clients use DELETE to remove a webhook.
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
    podcastId,
    userId: user.id,
    action: 'podcast.webhook.update',
    entityType: 'webhook',
    entityId: id,
    summary: `Updated webhook #${id}`,
    details: { fields: Object.keys(patch) },
  })

  return getWebhookSummary(id)
})
