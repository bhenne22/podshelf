import { defineEventHandler, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../../utils/auth'
import { deleteWebhook, getWebhookSummary } from '../../../../utils/webhook'
import { logAudit } from '../../../../utils/audit'

/**
 * DELETE /api/podcasts/[slug]/webhooks/[id]
 */
export default defineEventHandler((event) => {
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
  deleteWebhook(id)

  logAudit(event, {
    podcastId,
    userId: user.id,
    action: 'podcast.webhook.delete',
    entityType: 'webhook',
    entityId: id,
    summary: `Deleted webhook #${id}${existing.name ? ` "${existing.name}"` : ''}`,
  })

  return { ok: true }
})
