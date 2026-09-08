import { defineEventHandler, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../../../../utils/auth'
import { maybeAutoTrigger } from '../../../../../../utils/github'
import { logAudit } from '../../../../../../utils/audit'
import { requireEpisode, touchEpisodeForQuotes } from '../../../../../../utils/pull-quotes'
import getDb from '../../../../../../db/index'

/**
 * DELETE /api/podcasts/[slug]/episodes/[id]/pull-quotes/[quoteId]
 */
export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug') as string
  const id = Number(getRouterParam(event, 'id'))
  const quoteId = Number(getRouterParam(event, 'quoteId'))
  const { user, podcastId } = requirePodcastAccess(event, slug)

  const episode = requireEpisode(id, podcastId)
  if (!Number.isFinite(quoteId)) {
    throw createError({ statusCode: 400, statusMessage: 'quoteId required' })
  }

  const db = getDb()
  const result = db.prepare('DELETE FROM episode_pull_quotes WHERE id = ? AND episode_id = ?')
    .run(quoteId, id)
  if (result.changes === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Pull quote not found' })
  }

  touchEpisodeForQuotes(id)
  if (episode.status === 'published') {
    maybeAutoTrigger(podcastId, 'episode-pull-quotes-update')
  }

  logAudit(event, {
    podcastId,
    userId: user.id,
    action: 'episode.pull-quote.delete',
    entityType: 'episode',
    entityId: id,
    summary: `Removed a pull quote from "${episode.title || 'Untitled episode'}"`,
  })

  return { ok: true }
})
