import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../../utils/auth'
import { validateEpisodeFields, normalizeIsoDate } from '../../../../utils/validate'
import { maybeAutoTrigger } from '../../../../utils/github'
import { bumpFeedLastModified } from '../../../../utils/feed-cache'
import { logAudit, diffFields, summarizeChanges } from '../../../../utils/audit'
import { firePublishEvent } from '../../../../utils/publish-event'
import { fireRecordingEvent } from '../../../../utils/recording-event'
import { resolvePublishTiming } from '../../../../utils/scheduler'
import { slugify, isPlaceholderSlug } from '../../../../utils/text'
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
  'recording_starts_at', 'recording_duration_minutes',
]

/**
 * PATCH /api/podcasts/[slug]/episodes/[id]
 */
export default defineEventHandler(async (event) => {
  const slugParam = getRouterParam(event, 'slug') as string
  const id = getRouterParam(event, 'id')
  const { user, podcastId } = requirePodcastAccess(event, slugParam)

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'id is required' })
  }

  const db = getDb()
  const beforeRow = db.prepare(`SELECT ${UPDATABLE.join(', ')}, status AS _status FROM episodes WHERE id = ? AND podcast_id = ?`)
    .get(id, podcastId) as Record<string, unknown> & { _status: string } | undefined
  if (!beforeRow) {
    throw createError({ statusCode: 404, statusMessage: 'Episode not found' })
  }
  const beforeStatus = beforeRow._status

  const body = await readBody(event)
  validateEpisodeFields(body)

  // Canonicalize datetime inputs to ISO-8601 UTC (see episodes/index.post.ts) so
  // a scheduled/draft patch carrying a raw datetime-local value doesn't land an
  // unnormalized string in the DB via the UPDATABLE loop below.
  if ('published_at' in body) body.published_at = normalizeIsoDate(body.published_at)
  if ('recording_starts_at' in body) body.recording_starts_at = normalizeIsoDate(body.recording_starts_at)

  // Going live or scheduling requires a non-empty title — drafts can stay
  // title-less, but once it's heading for the feed it has to have a title.
  if (body.status === 'published' || body.status === 'scheduled') {
    const titleAfterPatch = ('title' in body ? body.title : beforeRow.title) as string | null | undefined
    if (!titleAfterPatch || (typeof titleAfterPatch === 'string' && titleAfterPatch.trim() === '')) {
      throw createError({ statusCode: 400, statusMessage: 'title is required to publish or schedule an episode' })
    }
  }

  if (body.status === 'published') {
    const incomingPubDate = 'published_at' in body ? body.published_at : beforeRow.published_at
    const resolved = resolvePublishTiming('published', incomingPubDate as string | null | undefined)
    body.status = resolved.status
    body.published_at = resolved.publishedAt
  }

  // When a title-less draft gets its title filled in, migrate the placeholder
  // slug (untitled-YYYY-MM-DD) to one derived from the new title. Skip when
  // the user explicitly supplies a slug in the same patch — they're telling
  // us what they want.
  if (
    'title' in body &&
    typeof body.title === 'string' &&
    body.title.trim() !== '' &&
    !('slug' in body) &&
    isPlaceholderSlug(beforeRow.slug as string | null | undefined)
  ) {
    const base = slugify(body.title)
    if (base) {
      let candidate = base
      let suffix = 2
      while (db.prepare('SELECT 1 FROM episodes WHERE podcast_id = ? AND slug = ? AND id != ?').get(podcastId, candidate, id)) {
        candidate = `${base}-${suffix}`
        suffix++
      }
      body.slug = candidate
    }
  }

  // Empty strings from the form mean "no value" for the recording fields —
  // normalize so a cleared datetime-local input doesn't land as "" in the DB.
  if ('recording_starts_at' in body && body.recording_starts_at === '') {
    body.recording_starts_at = null
  }
  if ('recording_duration_minutes' in body) {
    if (body.recording_duration_minutes === '' || body.recording_duration_minutes == null) {
      body.recording_duration_minutes = null
    } else {
      body.recording_duration_minutes = Number(body.recording_duration_minutes)
    }
  }

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

  const updated = db.prepare('SELECT * FROM episodes WHERE id = ?').get(id) as Record<string, unknown> & { status: string; title: string }

  const afterRow: Record<string, unknown> = {}
  for (const f of UPDATABLE) afterRow[f] = updated[f]
  delete (beforeRow as Record<string, unknown>)._status
  const diff = diffFields(beforeRow as Record<string, unknown>, afterRow)

  if (diff.changed.length > 0) {
    // Status flips get their own action so the audit feed is readable
    // (publish / unpublish / schedule are the events users actually care
    // about, vs general field edits).
    const displayTitle = updated.title || 'Untitled episode'
    let action = 'episode.update'
    let summary = summarizeChanges(`Updated episode "${displayTitle}"`, diff.changed)
    if (diff.changed.includes('status')) {
      const newStatus = updated.status
      if (newStatus === 'published') action = 'episode.publish'
      else if (newStatus === 'draft' && beforeStatus === 'published') action = 'episode.unpublish'
      summary = `${action === 'episode.publish' ? 'Published' :
                  action === 'episode.unpublish' ? 'Reverted to draft' :
                  'Updated'} "${displayTitle}"`
    }
    logAudit(event, {
      podcastId,
      userId: user.id,
      action,
      entityType: 'episode',
      entityId: Number(id),
      summary,
      details: diff,
    })
  }

  // The "just became live" transition fires the webhook (via firePublishEvent).
  // Edits to already-live episodes still bump the feed cache + trigger CI but
  // skip the webhook so we don't spam the channel on every typo fix.
  const becamePublished = beforeStatus !== 'published' && updated.status === 'published'
  const wasOrIsPublished = beforeStatus === 'published' || updated.status === 'published'
  if (becamePublished) {
    await firePublishEvent(podcastId, Number(id), 'episode-update', user.id, event.context.apiKeyId ?? null)
  } else if (wasOrIsPublished) {
    bumpFeedLastModified(podcastId)
    maybeAutoTrigger(podcastId, 'episode-update')
  }

  // Recording-change notification. Three transitions worth signalling:
  //   - none → set      : 'scheduled'
  //   - set → different : 'moved'  (either timestamp or duration changed)
  //   - set → none      : 'cancelled'
  // A duration-only change with no start-time change still counts as 'moved'
  // since it shifts the block end on subscribers' calendars.
  const prevStarts = (beforeRow.recording_starts_at as string | null | undefined) ?? null
  const prevDuration = (beforeRow.recording_duration_minutes as number | null | undefined) ?? null
  const nextStarts = (updated.recording_starts_at as string | null | undefined) ?? null
  const nextDuration = (updated.recording_duration_minutes as number | null | undefined) ?? null
  const startsChanged = (prevStarts || null) !== (nextStarts || null)
  const durationChanged = (prevDuration ?? null) !== (nextDuration ?? null)
  if (startsChanged || durationChanged) {
    let recKind: 'scheduled' | 'moved' | 'cancelled' | null = null
    if (!prevStarts && nextStarts) recKind = 'scheduled'
    else if (prevStarts && !nextStarts) recKind = 'cancelled'
    else if (prevStarts && nextStarts) recKind = 'moved'
    // Note: !prevStarts && !nextStarts is impossible here — that's the
    // "no change" branch, which means startsChanged must have been false.
    // A pure duration-only change with both timestamps null also stays out
    // (calendar has no event to update).
    if (recKind) {
      await fireRecordingEvent({
        podcastId,
        episodeId: Number(id),
        kind: recKind,
        newStartsAt: nextStarts,
        newDurationMinutes: nextDuration,
        previousStartsAt: prevStarts,
        previousDurationMinutes: prevDuration,
        actorUserId: user.id,
        actorApiKeyId: event.context.apiKeyId ?? null,
      })
    }
  }

  return updated
})
