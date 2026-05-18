import { defineEventHandler, getRouterParam } from 'h3'
import { requirePodcastAccess } from '../../../../utils/auth'
import { listPodcastWebhooks } from '../../../../utils/webhook'

/**
 * GET /api/podcasts/[slug]/webhooks
 *
 * Redacted list of this podcast's webhooks (URL replaced by url_host hint).
 */
export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { podcastId } = requirePodcastAccess(event, slug)
  return listPodcastWebhooks(podcastId)
})
