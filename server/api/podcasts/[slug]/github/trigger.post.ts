import { defineEventHandler, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../../utils/auth'
import { dispatchRepositoryEvent, loadGithubConfig, clearPublishDirty, isDeploysPaused } from '../../../../utils/github'
import { logAudit } from '../../../../utils/audit'

/**
 * POST /api/podcasts/[slug]/github/trigger
 *
 * Manually fire a repository_dispatch using the saved config. Used by
 * the "Rebuild Now" button. Open to any podcast member — non-admins can't
 * see/edit the GitHub config, but they can fire whatever's already saved.
 * That's the point of having a per-podcast pending-changes banner.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { user, podcastId } = requirePodcastAccess(event, slug)

  if (isDeploysPaused(podcastId)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Deploys are paused for this podcast. Toggle the kill switch off on the Build page to fire a dispatch.',
    })
  }

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
      { slug, reason: 'podshelf:manual', podcast_id: podcastId, fired_at: new Date().toISOString() },
    )
    // Manual rebuild satisfies any pending changes; clear the dirty window
    // so the banner disappears and the next edit starts a fresh debounce.
    clearPublishDirty(podcastId)
    logAudit(event, {
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
