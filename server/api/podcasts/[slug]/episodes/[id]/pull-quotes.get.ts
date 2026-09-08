import { defineEventHandler, getRouterParam } from 'h3'
import { requirePodcastAccess } from '../../../../../utils/auth'
import { requireEpisode, listPullQuotes } from '../../../../../utils/pull-quotes'

/**
 * GET /api/podcasts/[slug]/episodes/[id]/pull-quotes
 *
 * Ordered list of this episode's pull quotes. Not in the RSS feed — this is
 * material for downstream surfaces (social cards, episode-page callouts).
 */
export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug') as string
  const id = Number(getRouterParam(event, 'id'))
  const { podcastId } = requirePodcastAccess(event, slug)

  requireEpisode(id, podcastId)
  return listPullQuotes(id)
})
