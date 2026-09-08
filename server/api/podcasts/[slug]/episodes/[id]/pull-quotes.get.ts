import { defineEventHandler, getRouterParam, getQuery } from 'h3'
import { requirePodcastAccess } from '../../../../../utils/auth'
import { requireEpisode, listPullQuotes, parseApprovedFilter } from '../../../../../utils/pull-quotes'

/**
 * GET /api/podcasts/[slug]/episodes/[id]/pull-quotes
 *
 * An episode's pull quotes in display order. Not in the RSS feed — this is
 * material for downstream surfaces (social cards, episode-page callouts).
 *
 * `?approved=true` (the default) returns only quotes a human has approved.
 * That's the shape a site build wants: generated candidates stay invisible
 * until someone has reviewed them, and "give me the top 3" is just the first
 * three of this list.
 *
 * `?approved=any` returns the full review queue, approved or not. That's the
 * episode editor's view.
 */
export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug') as string
  const id = Number(getRouterParam(event, 'id'))
  const { podcastId } = requirePodcastAccess(event, slug)

  requireEpisode(id, podcastId)
  return listPullQuotes(id, parseApprovedFilter(getQuery(event).approved))
})
