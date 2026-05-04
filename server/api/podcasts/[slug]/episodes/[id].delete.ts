import { defineEventHandler, getRouterParam, createError, setResponseStatus } from 'h3'
import { requirePodcastAccess } from '../../../../utils/auth'
import { maybeAutoTrigger } from '../../../../utils/github'
import { bumpFeedLastModified } from '../../../../utils/feed-cache'
import { logAudit } from '../../../../utils/audit'
import getDb from '../../../../db/index'

/**
 * DELETE /api/podcasts/[slug]/episodes/[id]
 */
export default defineEventHandler((event) => {
  const slugParam = getRouterParam(event, 'slug') as string
  const id = getRouterParam(event, 'id')
  const { user, podcastId } = requirePodcastAccess(event, slugParam)

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'id is required' })
  }

  const db = getDb()
  const existing = db.prepare('SELECT id, status, title FROM episodes WHERE id = ? AND podcast_id = ?')
    .get(id, podcastId) as { id: number; status: string; title: string } | undefined
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Episode not found' })
  }

  db.prepare('DELETE FROM episodes WHERE id = ?').run(id)

  logAudit({
    podcastId,
    userId: user.id,
    action: 'episode.delete',
    entityType: 'episode',
    entityId: Number(id),
    summary: `Deleted episode "${existing.title}" (was ${existing.status})`,
  })

  if (existing.status === 'published') {
    bumpFeedLastModified(podcastId)
    maybeAutoTrigger(podcastId, 'episode-delete')
  }

  setResponseStatus(event, 204)
  return null
})
