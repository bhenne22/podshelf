import { defineEventHandler, getRouterParam, createError, setResponseStatus } from 'h3'
import { requirePodcastAccess } from '../../../../utils/auth'
import { maybeAutoTrigger } from '../../../../utils/github'
import { bumpFeedLastModified } from '../../../../utils/feed-cache'
import { logAudit } from '../../../../utils/audit'
import { fireRecordingEvent } from '../../../../utils/recording-event'
import getDb from '../../../../db/index'

/**
 * DELETE /api/podcasts/[slug]/episodes/[id]
 */
export default defineEventHandler(async (event) => {
  const slugParam = getRouterParam(event, 'slug') as string
  const id = getRouterParam(event, 'id')
  const { user, podcastId } = requirePodcastAccess(event, slugParam)

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'id is required' })
  }

  const db = getDb()
  const existing = db.prepare(`
    SELECT id, status, title, recording_starts_at, recording_duration_minutes
    FROM episodes WHERE id = ? AND podcast_id = ?
  `).get(id, podcastId) as {
    id: number
    status: string
    title: string
    recording_starts_at: string | null
    recording_duration_minutes: number | null
  } | undefined
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Episode not found' })
  }

  // Fire the recording-cancelled webhook BEFORE the DELETE so the
  // episode row (used by the formatter to look up title + numbers) is
  // still present. Only when there was actually a recording slot to
  // cancel — silent on episodes that never had one.
  const hadRecording = !!existing.recording_starts_at
  if (hadRecording) {
    await fireRecordingEvent({
      podcastId,
      episodeId: Number(id),
      kind: 'cancelled',
      newStartsAt: null,
      newDurationMinutes: null,
      previousStartsAt: existing.recording_starts_at,
      previousDurationMinutes: existing.recording_duration_minutes,
      actorUserId: user.id,
      actorApiKeyId: event.context.apiKeyId ?? null,
    })
  }

  db.prepare('DELETE FROM episodes WHERE id = ?').run(id)

  logAudit(event, {
    podcastId,
    userId: user.id,
    action: 'episode.delete',
    entityType: 'episode',
    entityId: Number(id),
    summary: `Deleted episode "${existing.title || 'Untitled episode'}" (was ${existing.status})`,
  })

  if (existing.status === 'published') {
    bumpFeedLastModified(podcastId)
    maybeAutoTrigger(podcastId, 'episode-delete')
  }

  setResponseStatus(event, 204)
  return null
})
