import { defineEventHandler, readBody, getRouterParam, createError } from 'h3'
import { requirePodcastAccess } from '../../../../utils/auth'
import getDb from '../../../../db/index'

/**
 * POST /api/podcasts/[slug]/distribution/reorder
 * Body: { ids: [3, 1, 2] }
 *
 * Rewrites the position column to match the supplied order. Every distribution
 * id in the request must belong to this podcast, and the request must contain
 * exactly the same set of ids the podcast currently has — partial reorders
 * are rejected so we don't silently leave rows out of place.
 *
 * No audit-log entry: drag-to-reorder is noisy and not interesting historically.
 */
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { podcastId } = requirePodcastAccess(event, slug)

  const body = await readBody(event)
  const rawIds = body?.ids
  if (!Array.isArray(rawIds)) {
    throw createError({ statusCode: 400, statusMessage: 'ids array is required' })
  }
  const ids = rawIds.map((v) => Number(v))
  if (ids.some((n) => !Number.isFinite(n))) {
    throw createError({ statusCode: 400, statusMessage: 'ids must all be numeric' })
  }

  const db = getDb()
  const owned = db.prepare(
    'SELECT id FROM podcast_distributions WHERE podcast_id = ?'
  ).all(podcastId) as { id: number }[]
  const ownedSet = new Set(owned.map((r) => r.id))

  if (ids.length !== ownedSet.size || ids.some((n) => !ownedSet.has(n))) {
    throw createError({
      statusCode: 400,
      statusMessage: 'ids must be exactly the distributions belonging to this podcast',
    })
  }

  const update = db.prepare(
    'UPDATE podcast_distributions SET position = ?, updated_at = datetime(\'now\') WHERE id = ? AND podcast_id = ?'
  )
  const txn = db.transaction((ordered: number[]) => {
    ordered.forEach((id, i) => update.run(i, id, podcastId))
  })
  txn(ids)

  return { ok: true, count: ids.length }
})
