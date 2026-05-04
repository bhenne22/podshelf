import { defineEventHandler, getRouterParam } from 'h3'
import { requirePodcastAccess } from '../../../utils/auth'
import getDb from '../../../db/index'

/**
 * GET /api/podcasts/[slug]/aliases
 *
 * Returns this podcast's previous slugs (chronological), each still
 * serving its old feed URL with `<itunes:new-feed-url>` redirecting
 * apps to the canonical feed.
 */
export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { podcastId } = requirePodcastAccess(event, slug)
  const db = getDb()
  return db.prepare(`
    SELECT id, old_slug, created_at
    FROM slug_aliases WHERE podcast_id = ?
    ORDER BY created_at DESC
  `).all(podcastId)
})
