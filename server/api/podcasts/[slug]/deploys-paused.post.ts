import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../utils/auth'
import { isDeploysPaused, setDeploysPaused } from '../../../utils/github'
import { logAudit } from '../../../utils/audit'

/**
 * POST /api/podcasts/[slug]/deploys-paused
 *
 * Admin-only kill switch for the per-podcast repository_dispatch path.
 * When paused: scheduler skips its tick, manual Rebuild + Test return 409.
 * Dirty markers keep accumulating so unpause flows naturally into a build.
 *
 * Body: { paused: boolean }
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { user, podcastId } = requirePodcastAccess(event, slug)
  if (!user.is_admin) {
    throw createError({ statusCode: 403, statusMessage: 'Admin only' })
  }

  const body = await readBody(event)
  const paused = !!(body && body.paused)

  const before = isDeploysPaused(podcastId)
  if (before === paused) {
    return { ok: true, paused, changed: false }
  }

  setDeploysPaused(podcastId, paused)
  logAudit(event, {
    podcastId,
    userId: user.id,
    action: paused ? 'podcast.deploys.pause' : 'podcast.deploys.resume',
    entityType: 'podcast',
    entityId: podcastId,
    summary: paused
      ? 'Paused deploys (kill switch on)'
      : 'Resumed deploys (kill switch off)',
  })
  return { ok: true, paused, changed: true }
})
