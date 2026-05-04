import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../../utils/auth'
import { validateEpisodeFields } from '../../../../utils/validate'
import { maybeAutoTrigger } from '../../../../utils/github'
import { bumpFeedLastModified } from '../../../../utils/feed-cache'
import getDb from '../../../../db/index'

const UPDATABLE = [
  'title', 'slug', 'episode_number', 'season_number',
  'description', 'audio_url', 'audio_filename', 'audio_size_bytes',
  'audio_duration_seconds', 'image_url', 'image_filename',
  'published_at', 'status', 'tags',
  'transcript_path', 'transcript_type', 'chapters_url', 'episode_type',
  'itunes_title', 'itunes_author', 'itunes_explicit',
  'season_name', 'episode_display',
  'license_identifier', 'license_url',
]

/**
 * PATCH /api/podcasts/[slug]/episodes/[id]
 */
export default defineEventHandler(async (event) => {
  const slugParam = getRouterParam(event, 'slug') as string
  const id = getRouterParam(event, 'id')
  const { podcastId } = requirePodcastAccess(event, slugParam)

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'id is required' })
  }

  const db = getDb()
  const existing = db.prepare('SELECT id, status FROM episodes WHERE id = ? AND podcast_id = ?')
    .get(id, podcastId) as { id: number; status: string } | undefined
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Episode not found' })
  }

  const body = await readBody(event)
  validateEpisodeFields(body)

  const updates: string[] = []
  const values: Record<string, unknown> = { id, podcast_id: podcastId }
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
  db.prepare(`UPDATE episodes SET ${updates.join(', ')} WHERE id = @id AND podcast_id = @podcast_id`).run(values)

  const updated = db.prepare('SELECT * FROM episodes WHERE id = ?').get(id) as { status: string }

  // Fire if the episode is or was published — covers status flips and edits
  // to live episodes; ignores draft-only edits.
  if (existing.status === 'published' || updated.status === 'published') {
    bumpFeedLastModified(podcastId)
    maybeAutoTrigger(podcastId, 'episode-update')
  }

  return updated
})
