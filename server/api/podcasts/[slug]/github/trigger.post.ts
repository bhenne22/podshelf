import { defineEventHandler, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../../utils/auth'
import { dispatchRepositoryEvent, loadGithubConfig } from '../../../../utils/github'
import { logAudit } from '../../../../utils/audit'

/**
 * POST /api/podcasts/[slug]/github/trigger
 *
 * Manually fire a repository_dispatch using the saved config. Used by
 * the "Rebuild now" button.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { user, podcastId } = requirePodcastAccess(event, slug)

  const config = loadGithubConfig(podcastId)
  if (!config) {
    throw createError({
      statusCode: 400,
      statusMessage: 'GitHub is not fully configured for this podcast (need owner, repo, event_type, and token)',
    })
  }

  try {
    const result = await dispatchRepositoryEvent(
      config,
      { reason: 'podshelf:manual', podcast_id: podcastId, fired_at: new Date().toISOString() },
    )
    logAudit({
      podcastId,
      userId: user.id,
      action: 'podcast.github.trigger',
      entityType: 'podcast',
      entityId: podcastId,
      summary: `Manually triggered GitHub rebuild (${config.owner}/${config.repo})`,
    })
    return { ok: true, status: result.status }
  } catch (err: unknown) {
    throw createError({
      statusCode: 400,
      statusMessage: err instanceof Error ? err.message : 'Dispatch failed',
    })
  }
})
