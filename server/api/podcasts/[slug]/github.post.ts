import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../utils/auth'
import { saveGithubConfig } from '../../../utils/github'
import { logAudit } from '../../../utils/audit'

/**
 * POST /api/podcasts/[slug]/github
 *
 * Body: { owner, repo, event_type, token?, auto_trigger }
 *
 * If token is omitted/blank, the existing encrypted token is preserved.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { user, podcastId } = requirePodcastAccess(event, slug)

  const body = await readBody(event)
  const owner = String(body?.owner || '').trim()
  const repo = String(body?.repo || '').trim()
  const eventType = String(body?.event_type || '').trim()
  const token = body?.token ? String(body.token) : ''
  const autoTrigger = !!body?.auto_trigger

  if (!owner || !repo || !eventType) {
    throw createError({ statusCode: 400, statusMessage: 'owner, repo, and event_type are required' })
  }

  saveGithubConfig(podcastId, {
    owner,
    repo,
    event_type: eventType,
    token: token || undefined,
    auto_trigger: autoTrigger,
  })

  logAudit(event, {
    podcastId,
    userId: user.id,
    action: 'podcast.github.update',
    entityType: 'podcast',
    entityId: podcastId,
    summary: `Updated GitHub config (${owner}/${repo}, event ${eventType}, auto-trigger ${autoTrigger ? 'on' : 'off'})`,
  })

  return { ok: true }
})
