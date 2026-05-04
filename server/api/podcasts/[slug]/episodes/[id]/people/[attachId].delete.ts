import { defineEventHandler, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../../../../utils/auth'
import { bumpFeedLastModified } from '../../../../../../utils/feed-cache'
import { maybeAutoTrigger } from '../../../../../../utils/github'
import getDb from '../../../../../../db/index'

/**
 * DELETE /api/podcasts/[slug]/episodes/[id]/people/[attachId]
 *
 * Detaches a person from a single episode without affecting other episodes.
 */
export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug') as string
  const epId = Number(getRouterParam(event, 'id'))
  const attachId = Number(getRouterParam(event, 'attachId'))
  const { podcastId } = requirePodcastAccess(event, slug)

  if (!Number.isFinite(epId) || !Number.isFinite(attachId)) {
    throw createError({ statusCode: 400, statusMessage: 'episode id and attachId required' })
  }

  const db = getDb()
  const ep = db.prepare('SELECT id, status FROM episodes WHERE id = ? AND podcast_id = ?')
    .get(epId, podcastId) as { id: number; status: string } | undefined
  if (!ep) {
    throw createError({ statusCode: 404, statusMessage: 'Episode not found' })
  }

  const result = db.prepare(
    'DELETE FROM episode_people WHERE id = ? AND episode_id = ?'
  ).run(attachId, epId)

  if (result.changes === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Attachment not found' })
  }

  if (ep.status === 'published') {
    bumpFeedLastModified(podcastId)
    maybeAutoTrigger(podcastId, 'episode-people-update')
  }

  return { ok: true }
})
