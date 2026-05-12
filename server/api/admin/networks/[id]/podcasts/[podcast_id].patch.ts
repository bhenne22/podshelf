import { defineEventHandler, getRouterParam, readBody, createError } from 'h3'
import { requireAdmin } from '../../../../../utils/auth'
import { logAudit } from '../../../../../utils/audit'
import getDb from '../../../../../db/index'

/**
 * PATCH /api/admin/networks/[id]/podcasts/[podcast_id]
 *
 * Update a network membership's position. Used by the admin UI's reorder
 * affordance. Separate from the add endpoint so audit-log entries for
 * reorders are distinct from add-to-network events.
 */
export default defineEventHandler(async (event) => {
  const user = requireAdmin(event)
  const networkId = Number(getRouterParam(event, 'id'))
  const podcastId = Number(getRouterParam(event, 'podcast_id'))
  if (!Number.isFinite(networkId) || !Number.isFinite(podcastId)) {
    throw createError({ statusCode: 400, statusMessage: 'network and podcast ids required' })
  }

  const db = getDb()
  const existing = db.prepare(
    'SELECT position FROM network_podcasts WHERE network_id = ? AND podcast_id = ?'
  ).get(networkId, podcastId) as { position: number } | undefined
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Podcast is not in this network' })
  }

  const body = await readBody(event)
  if (typeof body?.position !== 'number' || !Number.isFinite(body.position)) {
    throw createError({ statusCode: 400, statusMessage: 'position must be a number' })
  }
  const position = body.position

  db.prepare(
    'UPDATE network_podcasts SET position = ? WHERE network_id = ? AND podcast_id = ?'
  ).run(position, networkId, podcastId)

  logAudit(event, {
    podcastId,
    userId: user.id,
    action: 'network.podcast.reorder',
    entityType: 'network',
    entityId: networkId,
    summary: `Reordered podcast in network`,
    details: { from: existing.position, to: position },
  })

  return db.prepare(`
    SELECT p.id, p.slug, p.title, p.image_url, p.status, np.position
    FROM network_podcasts np
    JOIN podcasts p ON p.id = np.podcast_id
    WHERE np.network_id = ?
    ORDER BY np.position, p.title
  `).all(networkId)
})
