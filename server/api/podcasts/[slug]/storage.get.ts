import { defineEventHandler, getRouterParam } from 'h3'
import { requirePodcastAccess } from '../../../utils/auth'
import { describePodcastStorage } from '../../../utils/storage-config'

/**
 * GET /api/podcasts/[slug]/storage
 *
 * Returns a redacted view of the storage config (which fields are set,
 * never the secrets themselves).
 */
export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { podcastId } = requirePodcastAccess(event, slug)
  return describePodcastStorage(podcastId)
})
