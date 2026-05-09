import type { H3Event } from 'h3'
import { createError } from 'h3'
import { requirePodcastAccess } from './auth'
import getDb from '../db/index'

/**
 * Wrapper around requirePodcastAccess that additionally enforces the
 * per-podcast `build_admin_only` flag. Use this on every endpoint that backs
 * the Build page (GitHub config + dispatch).
 *
 * Returns the same shape as requirePodcastAccess so callers don't have to
 * special-case it.
 */
export function requireBuildAccess(event: H3Event, slug: string) {
  const ctx = requirePodcastAccess(event, slug)
  if (ctx.user.is_admin) return ctx

  const row = getDb()
    .prepare('SELECT build_admin_only FROM podcasts WHERE id = ?')
    .get(ctx.podcastId) as { build_admin_only: number } | undefined
  if (row?.build_admin_only) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Build page is restricted to admins for this podcast',
    })
  }
  return ctx
}
