import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../../utils/auth'
import { validateEpisodeFields } from '../../../../utils/validate'
import { logAudit } from '../../../../utils/audit'
import { firePublishEvent } from '../../../../utils/publish-event'
import { coerceScheduledStatus } from '../../../../utils/scheduler'
import getDb from '../../../../db/index'

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * POST /api/podcasts/[slug]/episodes
 */
export default defineEventHandler(async (event) => {
  const slugParam = getRouterParam(event, 'slug') as string
  const { user, podcastId } = requirePodcastAccess(event, slugParam)

  const body = await readBody(event)
  if (!body?.title) {
    throw createError({ statusCode: 400, statusMessage: 'title is required' })
  }
  validateEpisodeFields(body)

  const db = getDb()

  let slug = body.slug ? slugify(String(body.slug)) : slugify(String(body.title))
  if (!slug) {
    throw createError({ statusCode: 400, statusMessage: 'unable to derive a slug from title' })
  }

  // Slug uniqueness is per-podcast.
  if (db.prepare('SELECT 1 FROM episodes WHERE podcast_id = ? AND slug = ?').get(podcastId, slug)) {
    let suffix = 2
    let candidate = `${slug}-${suffix}`
    while (db.prepare('SELECT 1 FROM episodes WHERE podcast_id = ? AND slug = ?').get(podcastId, candidate)) {
      suffix++
      candidate = `${slug}-${suffix}`
    }
    slug = candidate
  }

  // Coerce status: published + future date → scheduled.
  const desiredStatus = body.status ?? 'draft'
  const effectiveStatus = coerceScheduledStatus(desiredStatus, body.published_at) ?? 'draft'

  // A published episode must have a publish date — otherwise it shows up in
  // the feed with no <pubDate>, which clients sort to the bottom or hide.
  // Default to now() when the caller publishes without specifying a date.
  let publishedAt = body.published_at ?? null
  if (effectiveStatus === 'published' && !publishedAt) {
    publishedAt = new Date().toISOString()
  }

  const result = db.prepare(`
    INSERT INTO episodes (
      podcast_id, title, slug, episode_number, season_number,
      description, audio_url, audio_filename, audio_size_bytes,
      audio_duration_seconds, image_url, image_filename,
      published_at, status, tags, transcript_path, transcript_type,
      chapters_url, episode_type, itunes_title, itunes_author,
      itunes_explicit, season_name, episode_display,
      license_identifier, license_url
    ) VALUES (
      @podcast_id, @title, @slug, @episode_number, @season_number,
      @description, @audio_url, @audio_filename, @audio_size_bytes,
      @audio_duration_seconds, @image_url, @image_filename,
      @published_at, @status, @tags, @transcript_path, @transcript_type,
      @chapters_url, @episode_type, @itunes_title, @itunes_author,
      @itunes_explicit, @season_name, @episode_display,
      @license_identifier, @license_url
    )
  `).run({
    podcast_id: podcastId,
    title: body.title,
    slug,
    episode_number: body.episode_number ?? null,
    season_number: body.season_number ?? null,
    description: body.description ?? null,
    audio_url: body.audio_url ?? null,
    audio_filename: body.audio_filename ?? null,
    audio_size_bytes: body.audio_size_bytes ?? null,
    audio_duration_seconds: body.audio_duration_seconds ?? null,
    image_url: body.image_url ?? null,
    image_filename: body.image_filename ?? null,
    published_at: publishedAt,
    status: effectiveStatus,
    tags: body.tags ?? null,
    transcript_path: body.transcript_path ?? null,
    transcript_type: body.transcript_type ?? null,
    chapters_url: body.chapters_url ?? null,
    episode_type: body.episode_type ?? 'full',
    itunes_title: body.itunes_title ?? null,
    itunes_author: body.itunes_author ?? null,
    itunes_explicit: body.itunes_explicit ?? null,
    season_name: body.season_name ?? null,
    episode_display: body.episode_display ?? null,
    license_identifier: body.license_identifier ?? null,
    license_url: body.license_url ?? null,
  })

  const episodeId = Number(result.lastInsertRowid)

  // Auto-attach people that are flagged for it; freeze role/group at attach
  // time so a later edit to people.default_role doesn't rewrite history.
  const autoAttachPeople = db.prepare(
    'SELECT id, default_role, default_group FROM people WHERE podcast_id = ? AND auto_attach = 1 ORDER BY id'
  ).all(podcastId) as { id: number; default_role: string; default_group: string }[]
  if (autoAttachPeople.length > 0) {
    const attach = db.prepare(
      'INSERT INTO episode_people (episode_id, person_id, role, "group", position) VALUES (?, ?, ?, ?, ?)'
    )
    db.transaction(() => {
      let i = 0
      for (const p of autoAttachPeople) {
        attach.run(episodeId, p.id, p.default_role, p.default_group, i++)
      }
    })()
  }

  const episode = db.prepare('SELECT * FROM episodes WHERE id = ?').get(episodeId) as { status: string }

  logAudit({
    podcastId,
    userId: user.id,
    action: 'episode.create',
    entityType: 'episode',
    entityId: episodeId,
    summary: `Created episode "${body.title}" as ${episode.status}`,
  })

  // Only kick a rebuild if this episode lands in the published feed.
  if (episode.status === 'published') {
    await firePublishEvent(podcastId, episodeId, 'episode-create', user.id)
  }

  event.node.res.statusCode = 201
  return episode
})
