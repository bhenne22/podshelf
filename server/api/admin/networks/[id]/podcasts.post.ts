import { defineEventHandler, getRouterParam, readBody, createError } from 'h3'
import { requireAdmin } from '../../../../utils/auth'
import { logAudit } from '../../../../utils/audit'
import getDb from '../../../../db/index'

/**
 * POST /api/admin/networks/[id]/podcasts
 *
 * Adds a podcast to the network. Body: { podcast_id, position? }.
 * New rows go to the bottom by default (position = max + 1). INSERT OR
 * IGNORE makes re-adding a no-op.
 */
export default defineEventHandler(async (event) => {
  const user = requireAdmin(event)
  const networkId = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(networkId)) {
    throw createError({ statusCode: 400, statusMessage: 'network id required' })
  }

  const db = getDb()
  const network = db.prepare(
    'SELECT id, title FROM networks WHERE id = ?'
  ).get(networkId) as { id: number; title: string } | undefined
  if (!network) {
    throw createError({ statusCode: 404, statusMessage: 'Network not found' })
  }

  const body = await readBody(event)
  const podcastId = Number(body?.podcast_id)
  if (!Number.isFinite(podcastId)) {
    throw createError({ statusCode: 400, statusMessage: 'podcast_id is required' })
  }
  const podcast = db.prepare(
    'SELECT id, title, slug FROM podcasts WHERE id = ?'
  ).get(podcastId) as { id: number; title: string; slug: string } | undefined
  if (!podcast) {
    throw createError({ statusCode: 404, statusMessage: 'Podcast not found' })
  }

  let position: number
  if (typeof body?.position === 'number' && Number.isFinite(body.position)) {
    position = body.position
  } else {
    const max = db.prepare(
      'SELECT COALESCE(MAX(position), -1) AS m FROM network_podcasts WHERE network_id = ?'
    ).get(networkId) as { m: number }
    position = (max?.m ?? -1) + 1
  }

  db.prepare(`
    INSERT OR IGNORE INTO network_podcasts (network_id, podcast_id, position)
    VALUES (?, ?, ?)
  `).run(networkId, podcastId, position)

  logAudit(event, {
    podcastId,
    userId: user.id,
    action: 'network.podcast.add',
    entityType: 'network',
    entityId: networkId,
    summary: `Added "${podcast.title}" to network "${network.title}"`,
  })

  return db.prepare(`
    SELECT p.id, p.slug, p.title, p.image_url, p.status, np.position
    FROM network_podcasts np
    JOIN podcasts p ON p.id = np.podcast_id
    WHERE np.network_id = ?
    ORDER BY np.position, p.title
  `).all(networkId)
})
