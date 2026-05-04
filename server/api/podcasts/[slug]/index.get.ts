import { defineEventHandler, getRouterParam } from 'h3'
import { requirePodcastAccess } from '../../../utils/auth'
import getDb from '../../../db/index'

/**
 * GET /api/podcasts/[slug]
 *
 * Returns the podcast row (without secret-bearing fields). Membership required.
 */
export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug') as string
  requirePodcastAccess(event, slug)

  const db = getDb()
  return db.prepare(`
    SELECT
      id, slug, title, description, author, email, image_url, language,
      copyright, category, explicit, website, audio_tracking_prefix,
      itunes_type, podcast_locked,
      storage_adapter, github_owner, github_repo, github_event_type,
      status, deleted_at, created_at, updated_at
    FROM podcasts
    WHERE slug = ?
  `).get(slug)
})
