import { defineEventHandler, getRouterParam } from 'h3'
import { requireBuildAccess } from '../../../utils/build-access'
import { describeGithubConfig } from '../../../utils/github'

/**
 * GET /api/podcasts/[slug]/github
 *
 * Returns a redacted view of the GitHub config (no token).
 */
export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { podcastId } = requireBuildAccess(event, slug)
  return describeGithubConfig(podcastId)
})
