import { defineEventHandler, getRouterParam } from 'h3'
import { requirePodcastAccess } from '../../../../utils/auth'
import { getCurrentMigration } from '../../../../utils/storage-migration'

/**
 * GET /api/podcasts/[slug]/storage/migrate
 *
 * Most-recent migration row for this podcast (or null). UI polls this
 * every 2s while a migration is running.
 */
export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { podcastId } = requirePodcastAccess(event, slug)
  return getCurrentMigration(podcastId)
})
