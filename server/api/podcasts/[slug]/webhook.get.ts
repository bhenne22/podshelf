import { defineEventHandler, getRouterParam } from 'h3'
import { requirePodcastAccess } from '../../../utils/auth'
import { describeWebhookConfig } from '../../../utils/webhook'

/**
 * GET /api/podcasts/[slug]/webhook
 *
 * Returns the (redacted) webhook config: whether a URL is set, the format,
 * the enabled flag, and the URL host (for "Configured for discord.com"
 * style hints without leaking the token in the URL path).
 */
export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { podcastId } = requirePodcastAccess(event, slug)
  return describeWebhookConfig(podcastId)
})
