import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../utils/auth'
import { maybeAutoTrigger } from '../../../utils/github'
import getDb from '../../../db/index'

// Fields that show up in the public RSS feed; an edit to any of these is
// reason to kick a rebuild.
const FEED_VISIBLE_FIELDS = new Set([
  'title', 'description', 'author', 'email', 'image_url', 'language',
  'copyright', 'category', 'explicit', 'website', 'audio_tracking_prefix',
])

const UPDATABLE = [
  'title', 'description', 'author', 'email', 'image_url', 'language',
  'copyright', 'category', 'explicit', 'website', 'audio_tracking_prefix',
  'storage_adapter', 'github_owner', 'github_repo', 'github_event_type',
]

/**
 * PATCH /api/podcasts/[slug]
 *
 * Updates podcast metadata / settings. Requires podcast membership.
 * Storage credentials and GitHub tokens are not editable here — use the
 * dedicated endpoints once those land.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { podcastId } = requirePodcastAccess(event, slug)

  const body = await readBody(event)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: 'Body must be a key/value object' })
  }

  const db = getDb()

  const updates: string[] = []
  const values: Record<string, unknown> = { id: podcastId }
  for (const field of UPDATABLE) {
    if (field in body) {
      updates.push(`${field} = @${field}`)
      values[field] = body[field]
    }
  }

  if (!updates.length) {
    throw createError({ statusCode: 400, statusMessage: 'No valid fields to update' })
  }

  updates.push(`updated_at = datetime('now')`)
  db.prepare(`UPDATE podcasts SET ${updates.join(', ')} WHERE id = @id`).run(values)

  const touchedFeedField = Object.keys(body).some((k) => FEED_VISIBLE_FIELDS.has(k))
  if (touchedFeedField) {
    maybeAutoTrigger(podcastId, 'podcast-settings-update')
  }

  return db.prepare(`
    SELECT
      id, slug, title, description, author, email, image_url, language,
      copyright, category, explicit, website, audio_tracking_prefix,
      storage_adapter, github_owner, github_repo, github_event_type,
      created_at, updated_at
    FROM podcasts WHERE id = ?
  `).get(podcastId)
})
