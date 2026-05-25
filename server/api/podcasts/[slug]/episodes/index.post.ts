import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../../utils/auth'
import { validateEpisodeFields } from '../../../../utils/validate'
import { logAudit } from '../../../../utils/audit'
import { firePublishEvent } from '../../../../utils/publish-event'
import { fireRecordingEvent } from '../../../../utils/recording-event'
import { resolvePublishTiming } from '../../../../utils/scheduler'
import { slugify } from '../../../../utils/text'
import getDb from '../../../../db/index'

/**
 * POST /api/podcasts/[slug]/episodes
 */
export default defineEventHandler(async (event) => {
  const slugParam = getRouterParam(event, 'slug') as string
  const { user, podcastId } = requirePodcastAccess(event, slugParam)

  const body = await readBody(event)
  validateEpisodeFields(body)

  // Title is only required when the episode will be live or scheduled — drafts
  // can be created title-less so the user can reserve a recording slot before
  // they know what to call it. The slug then falls back to a date-based
  // placeholder (handled below) so the row still has a valid URL key.
  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  const incomingStatus = body?.status ?? 'draft'
  if ((incomingStatus === 'published' || incomingStatus === 'scheduled') && !title) {
    throw createError({ statusCode: 400, statusMessage: 'title is required to publish or schedule an episode' })
  }

  const db = getDb()

  let slug = body.slug ? slugify(String(body.slug)) : (title ? slugify(title) : '')
  if (!slug) {
    // No title (or title slugified to empty, e.g. emoji-only). Use today's date
    // as a stable placeholder; the collision loop below will suffix as needed.
    const today = new Date().toISOString().slice(0, 10)
    slug = `untitled-${today}`
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

  const resolved = resolvePublishTiming(body.status ?? 'draft', body.published_at)
  const effectiveStatus = resolved.status ?? 'draft'
  const publishedAt = resolved.publishedAt

  // Empty strings from the form mean "no value." Normalize before INSERT so a
  // datetime-local picker that the user cleared doesn't land in the DB as "".
  const recordingStartsAt = body.recording_starts_at === '' ? null : (body.recording_starts_at ?? null)
  const recordingDurationMinutes =
    body.recording_duration_minutes === '' || body.recording_duration_minutes == null
      ? null
      : Number(body.recording_duration_minutes)

  const result = db.prepare(`
    INSERT INTO episodes (
      podcast_id, title, slug, episode_number, season_number,
      description, audio_url, audio_filename, audio_size_bytes,
      audio_duration_seconds, image_url, image_filename,
      published_at, status, tags, transcript_path, transcript_type,
      chapters_url, episode_type, itunes_title, itunes_author,
      itunes_explicit, season_name, episode_display,
      license_identifier, license_url,
      recording_starts_at, recording_duration_minutes
    ) VALUES (
      @podcast_id, @title, @slug, @episode_number, @season_number,
      @description, @audio_url, @audio_filename, @audio_size_bytes,
      @audio_duration_seconds, @image_url, @image_filename,
      @published_at, @status, @tags, @transcript_path, @transcript_type,
      @chapters_url, @episode_type, @itunes_title, @itunes_author,
      @itunes_explicit, @season_name, @episode_display,
      @license_identifier, @license_url,
      @recording_starts_at, @recording_duration_minutes
    )
  `).run({
    podcast_id: podcastId,
    title,
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
    recording_starts_at: recordingStartsAt,
    recording_duration_minutes: recordingDurationMinutes,
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

  logAudit(event, {
    podcastId,
    userId: user.id,
    action: 'episode.create',
    entityType: 'episode',
    entityId: episodeId,
    summary: `Created episode "${title || 'Untitled episode'}" as ${episode.status}`,
  })

  // Only kick a rebuild if this episode lands in the published feed.
  if (episode.status === 'published') {
    await firePublishEvent(podcastId, episodeId, 'episode-create', user.id, event.context.apiKeyId ?? null)
  }

  // Fire the recording webhook when this episode was created with a
  // recording slot already set — same notification a later PATCH would fire.
  if (recordingStartsAt) {
    await fireRecordingEvent({
      podcastId,
      episodeId,
      kind: 'scheduled',
      newStartsAt: recordingStartsAt,
      newDurationMinutes: recordingDurationMinutes,
      previousStartsAt: null,
      previousDurationMinutes: null,
      actorUserId: user.id,
      actorApiKeyId: event.context.apiKeyId ?? null,
    })
  }

  event.node.res.statusCode = 201
  return episode
})
