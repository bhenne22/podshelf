import { defineEventHandler, getRouterParam } from 'h3'
import { requirePodcastAccess } from '../../../../utils/auth'
import getDb from '../../../../db/index'

/**
 * GET /api/podcasts/[slug]/members
 *
 * Lists users with access to the podcast.
 */
export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { podcastId } = requirePodcastAccess(event, slug)

  const db = getDb()
  return db.prepare(`
    SELECT u.id, u.email, u.is_admin, u.full_name, u.display_name, pu.created_at
    FROM podcast_users pu
    JOIN users u ON u.id = pu.user_id
    WHERE pu.podcast_id = ?
    ORDER BY COALESCE(u.display_name, u.full_name, u.email)
  `).all(podcastId)
})
