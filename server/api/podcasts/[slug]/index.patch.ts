import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../utils/auth'
import { maybeAutoTrigger } from '../../../utils/github'
import { bumpFeedLastModified } from '../../../utils/feed-cache'
import getDb from '../../../db/index'

// Fields that show up in the public RSS feed; an edit to any of these is
// reason to kick a rebuild.
const FEED_VISIBLE_FIELDS = new Set([
  'title', 'description', 'author', 'email', 'image_url', 'language',
  'copyright', 'category', 'explicit', 'website', 'audio_tracking_prefix',
  'itunes_type', 'podcast_locked', 'itunes_complete', 'itunes_block',
  'funding_url', 'funding_label',
])

const UPDATABLE = [
  'slug',
  'title', 'description', 'author', 'email', 'image_url', 'language',
  'copyright', 'category', 'explicit', 'website', 'audio_tracking_prefix',
  'itunes_type', 'podcast_locked', 'itunes_complete', 'itunes_block',
  'funding_url', 'funding_label',
  'storage_adapter', 'github_owner', 'github_repo', 'github_event_type',
]

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

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

  if ('slug' in body) {
    const newSlug = typeof body.slug === 'string' ? body.slug.trim() : ''
    if (!newSlug || !SLUG_RE.test(newSlug)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'slug must be lowercase letters, digits, and hyphens (no leading/trailing hyphen)',
      })
    }
    if (newSlug !== slug) {
      const taken = db.prepare('SELECT 1 FROM podcasts WHERE slug = ? AND id != ?').get(newSlug, podcastId)
      if (taken) {
        throw createError({ statusCode: 409, statusMessage: `Podcast slug "${newSlug}" already exists` })
      }
    }
    body.slug = newSlug
  }

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
    bumpFeedLastModified(podcastId)
    maybeAutoTrigger(podcastId, 'podcast-settings-update')
  }

  return db.prepare(`
    SELECT
      id, slug, title, description, author, email, image_url, language,
      copyright, category, explicit, website, audio_tracking_prefix,
      itunes_type, podcast_locked, itunes_complete, itunes_block,
      funding_url, funding_label,
      storage_adapter, github_owner, github_repo, github_event_type,
      created_at, updated_at
    FROM podcasts WHERE id = ?
  `).get(podcastId)
})
