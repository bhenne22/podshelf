import { defineEventHandler, getRouterParam, createError } from 'h3'
import { requireAdmin } from '../../../../../utils/auth'
import { logAudit } from '../../../../../utils/audit'
import getDb from '../../../../../db/index'

/**
 * DELETE /api/admin/networks/[id]/podcasts/[podcast_id]
 *
 * Removes a podcast from a network. The podcast itself is untouched.
 */
export default defineEventHandler((event) => {
  const user = requireAdmin(event)
  const networkId = Number(getRouterParam(event, 'id'))
  const podcastId = Number(getRouterParam(event, 'podcast_id'))
  if (!Number.isFinite(networkId) || !Number.isFinite(podcastId)) {
    throw createError({ statusCode: 400, statusMessage: 'network and podcast ids required' })
  }

  const db = getDb()
  const network = db.prepare('SELECT title FROM networks WHERE id = ?').get(networkId) as
    { title: string } | undefined
  if (!network) {
    throw createError({ statusCode: 404, statusMessage: 'Network not found' })
  }
  const podcast = db.prepare('SELECT title FROM podcasts WHERE id = ?').get(podcastId) as
    { title: string } | undefined
  const result = db.prepare(
    'DELETE FROM network_podcasts WHERE network_id = ? AND podcast_id = ?'
  ).run(networkId, podcastId)
  if (result.changes === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Podcast is not in this network' })
  }

  logAudit(event, {
    podcastId,
    userId: user.id,
    action: 'network.podcast.remove',
    entityType: 'network',
    entityId: networkId,
    summary: `Removed "${podcast?.title ?? podcastId}" from network "${network.title}"`,
  })

  return { ok: true }
})
