import { defineEventHandler, getRouterParam } from 'h3'
import { requirePodcastAccess } from '../../../utils/auth'
import { describeGithubConfig } from '../../../utils/github'

/**
 * GET /api/podcasts/[slug]/publish-status
 *
 * Read-only view of build/publish state for the pending-changes banner. Any
 * podcast member can read this — no secrets are exposed (no token, no owner
 * if not configured) and triggering is allowed for non-admin members too.
 *
 * The `/api/podcasts/[slug]/github` endpoint is kept admin-gated separately
 * because it powers the *configuration* form (which surfaces owner/repo and
 * accepts a new PAT).
 */
export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { podcastId } = requirePodcastAccess(event, slug)

  const desc = describeGithubConfig(podcastId)
  return {
    configured: desc.configured,
    auto_trigger: desc.auto_trigger,
    pending: desc.pending,
  }
})
