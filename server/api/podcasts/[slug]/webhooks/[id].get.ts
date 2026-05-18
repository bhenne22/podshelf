import { defineEventHandler, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../../utils/auth'
import { getWebhookSummary } from '../../../../utils/webhook'

/**
 * GET /api/podcasts/[slug]/webhooks/[id]
 */
export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { podcastId } = requirePodcastAccess(event, slug)

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id)) {
    throw createError({ statusCode: 400, statusMessage: 'webhook id required' })
  }
  const wh = getWebhookSummary(id)
  if (!wh || wh.scope !== 'podcast' || wh.scope_id !== podcastId) {
    throw createError({ statusCode: 404, statusMessage: 'Webhook not found' })
  }
  return wh
})
