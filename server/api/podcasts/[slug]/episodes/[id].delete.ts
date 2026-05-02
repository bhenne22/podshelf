import { defineEventHandler, getRouterParam, createError, setResponseStatus } from 'h3'
import { requirePodcastAccess } from '../../../../utils/auth'
import { maybeAutoTrigger } from '../../../../utils/github'
import getDb from '../../../../db/index'

/**
 * DELETE /api/podcasts/[slug]/episodes/[id]
 */
export default defineEventHandler((event) => {
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

  db.prepare('DELETE FROM episodes WHERE id = ?').run(id)

  if (existing.status === 'published') {
    maybeAutoTrigger(podcastId, 'episode-delete')
  }

  setResponseStatus(event, 204)
  return null
})
