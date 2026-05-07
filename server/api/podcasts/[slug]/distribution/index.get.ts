import { defineEventHandler, getRouterParam } from 'h3'
import { requirePodcastAccess } from '../../../../utils/auth'
import getDb from '../../../../db/index'

/**
 * GET /api/podcasts/[slug]/distribution
 *
 * Lists the podcast's "Listen on" destinations in display order. Membership
 * required. Pure metadata — not surfaced in the RSS feed, but a static-site
 * build can fetch this on each publish to render a "Listen on" block.
 */
export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { podcastId } = requirePodcastAccess(event, slug)

  const db = getDb()
  return db.prepare(`
    SELECT id, podcast_id, name, url, platform_id, notes, position,
           created_at, updated_at
    FROM podcast_distributions
    WHERE podcast_id = ?
    ORDER BY position ASC, id ASC
  `).all(podcastId)
})
