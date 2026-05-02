import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../../utils/auth'
import { dispatchRepositoryEvent, loadGithubConfig, type GitHubConfig } from '../../../../utils/github'

/**
 * POST /api/podcasts/[slug]/github/test
 *
 * Sends a single repository_dispatch to verify credentials, returning
 * success or the GitHub error message.
 *
 * Body (all optional — falls back to saved config):
 *   { owner, repo, event_type, token, auto_trigger }
 *
 * If the body has no token but a config is saved, the saved encrypted
 * token is used. Lets users test without re-pasting the PAT.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { podcastId } = requirePodcastAccess(event, slug)

  const body = await readBody(event)
  const incoming = (body || {}) as Record<string, unknown>
  const saved = loadGithubConfig(podcastId)

  const config: Partial<GitHubConfig> = {
    owner: String(incoming.owner || saved?.owner || '').trim(),
    repo: String(incoming.repo || saved?.repo || '').trim(),
    event_type: String(incoming.event_type || saved?.event_type || '').trim(),
    token: incoming.token ? String(incoming.token) : saved?.token,
  }

  if (!config.owner || !config.repo || !config.event_type) {
    throw createError({ statusCode: 400, statusMessage: 'owner, repo, and event_type are required' })
  }
  if (!config.token) {
    throw createError({ statusCode: 400, statusMessage: 'token is required (no saved token to fall back on)' })
  }

  try {
    const result = await dispatchRepositoryEvent(
      config as GitHubConfig,
      { reason: 'podshelf:test', podcast_id: podcastId, fired_at: new Date().toISOString() },
    )
    return { ok: true, status: result.status }
  } catch (err: unknown) {
    throw createError({
      statusCode: 400,
      statusMessage: err instanceof Error ? err.message : 'Dispatch failed',
    })
  }
})
