import { defineEventHandler, getRouterParam } from 'h3'
import { requirePodcastAccess } from '../../../../utils/auth'
import getDb from '../../../../db/index'

/**
 * GET /api/podcasts/[slug]/people
 *
 * Lists every person in the podcast's roster. Membership required.
 */
export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { podcastId } = requirePodcastAccess(event, slug)

  const db = getDb()
  return db.prepare(`
    SELECT id, podcast_id, name, img_url, href,
           default_role, default_group, auto_attach,
           created_at, updated_at
    FROM people
    WHERE podcast_id = ?
    ORDER BY auto_attach DESC, name COLLATE NOCASE
  `).all(podcastId)
})
