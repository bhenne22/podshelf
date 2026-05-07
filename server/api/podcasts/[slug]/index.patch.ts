import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../utils/auth'
import { maybeAutoTrigger } from '../../../utils/github'
import { bumpFeedLastModified } from '../../../utils/feed-cache'
import { logAudit, diffFields, summarizeChanges } from '../../../utils/audit'
import getDb from '../../../db/index'

// Fields that show up in the public RSS feed; an edit to any of these is
// reason to kick a rebuild.
const FEED_VISIBLE_FIELDS = new Set([
  'title', 'description', 'author', 'email', 'image_url', 'language',
  'copyright', 'category', 'explicit', 'website', 'audio_tracking_prefix',
  'itunes_type', 'podcast_locked', 'itunes_complete', 'itunes_block',
  'funding_url', 'funding_label',
  'verify_txt', 'license_identifier', 'license_url',
])

const UPDATABLE = [
  'slug',
  'title', 'description', 'author', 'email', 'image_url', 'language',
  'copyright', 'category', 'explicit', 'website', 'audio_tracking_prefix',
  'itunes_type', 'podcast_locked', 'itunes_complete', 'itunes_block',
  'funding_url', 'funding_label',
  'verify_txt', 'license_identifier', 'license_url',
  'episode_title_template', 'episode_description_template',
  'seasons_enabled', 'episode_numbers_enabled',
  'storage_adapter', 'github_owner', 'github_repo', 'github_event_type',
]

const BOOL_INT_FIELDS = new Set(['seasons_enabled', 'episode_numbers_enabled'])

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
  const { user, podcastId } = requirePodcastAccess(event, slug)

  const body = await readBody(event)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({ statusCode: 400, statusMessage: 'Body must be a key/value object' })
  }

  const db = getDb()

  const before = db.prepare(`
    SELECT slug, title, description, author, email, image_url, language,
           copyright, category, explicit, website, audio_tracking_prefix,
           itunes_type, podcast_locked, itunes_complete, itunes_block,
           funding_url, funding_label, verify_txt, license_identifier, license_url,
           episode_title_template, episode_description_template,
           seasons_enabled, episode_numbers_enabled,
           storage_adapter, github_owner, github_repo, github_event_type
    FROM podcasts WHERE id = ?
  `).get(podcastId) as Record<string, unknown>

  let aliasRollback: { oldSlug: string } | null = null
  let aliasInsert: { oldSlug: string } | null = null
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
      // Disallow reusing another podcast's old slug — that would route
      // their old subscribers to your feed.
      const conflictAlias = db.prepare(`
        SELECT podcast_id FROM slug_aliases WHERE old_slug = ?
      `).get(newSlug) as { podcast_id: number } | undefined
      if (conflictAlias && conflictAlias.podcast_id !== podcastId) {
        throw createError({
          statusCode: 409,
          statusMessage: `Slug "${newSlug}" was previously used by another podcast and is permanently reserved`,
        })
      }
      // Self-alias: rolling back to a slug this podcast used before.
      // Remove that alias row since the slug becomes active again.
      if (conflictAlias && conflictAlias.podcast_id === podcastId) {
        aliasRollback = { oldSlug: newSlug }
      }
      // Stage the new alias row for after the UPDATE succeeds.
      aliasInsert = { oldSlug: slug }
    }
    body.slug = newSlug
  }

  const updates: string[] = []
  const values: Record<string, unknown> = { id: podcastId }
  for (const field of UPDATABLE) {
    if (field in body) {
      updates.push(`${field} = @${field}`)
      values[field] = BOOL_INT_FIELDS.has(field) ? (body[field] ? 1 : 0) : body[field]
    }
  }

  if (!updates.length) {
    throw createError({ statusCode: 400, statusMessage: 'No valid fields to update' })
  }

  updates.push(`updated_at = datetime('now')`)

  db.transaction(() => {
    db.prepare(`UPDATE podcasts SET ${updates.join(', ')} WHERE id = @id`).run(values)
    if (aliasRollback) {
      db.prepare('DELETE FROM slug_aliases WHERE old_slug = ? AND podcast_id = ?').run(
        aliasRollback.oldSlug,
        podcastId,
      )
    }
    if (aliasInsert) {
      db.prepare('INSERT INTO slug_aliases (podcast_id, old_slug) VALUES (?, ?)').run(
        podcastId,
        aliasInsert.oldSlug,
      )
    }
  })()

  const updated = db.prepare(`
    SELECT
      id, slug, title, description, author, email, image_url, language,
      copyright, category, explicit, website, audio_tracking_prefix,
      itunes_type, podcast_locked, itunes_complete, itunes_block,
      funding_url, funding_label, verify_txt, license_identifier, license_url,
      episode_title_template, episode_description_template,
      seasons_enabled, episode_numbers_enabled,
      storage_adapter, github_owner, github_repo, github_event_type,
      created_at, updated_at
    FROM podcasts WHERE id = ?
  `).get(podcastId) as Record<string, unknown>

  const diff = diffFields(before, updated)
  if (diff.changed.length > 0) {
    logAudit({
      podcastId,
      userId: user.id,
      action: 'podcast.settings.update',
      entityType: 'podcast',
      entityId: podcastId,
      summary: summarizeChanges('Updated podcast settings', diff.changed),
      details: diff,
    })
  }

  const touchedFeedField = Object.keys(body).some((k) => FEED_VISIBLE_FIELDS.has(k))
  if (touchedFeedField) {
    bumpFeedLastModified(podcastId)
    maybeAutoTrigger(podcastId, 'podcast-settings-update')
  }

  return updated
})
