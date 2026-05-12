import { defineEventHandler, getRouterParam, createError } from 'h3'
import { requireAdmin } from '../../../utils/auth'
import getDb from '../../../db/index'

/**
 * GET /api/admin/networks/[id]
 *
 * Admin detail view including the full roster — soft-deleted podcasts ARE
 * included here (with their status surfaced) so admins can see and clean up
 * stale members. The user-facing /api/networks/[slug] endpoint filters them.
 */
export default defineEventHandler((event) => {
  requireAdmin(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id)) {
    throw createError({ statusCode: 400, statusMessage: 'network id required' })
  }
  const db = getDb()
  const network = db.prepare(
    'SELECT id, slug, title, description, created_at, updated_at FROM networks WHERE id = ?'
  ).get(id) as { id: number } | undefined
  if (!network) {
    throw createError({ statusCode: 404, statusMessage: 'Network not found' })
  }
  const podcasts = db.prepare(`
    SELECT p.id, p.slug, p.title, p.image_url, p.status, np.position
    FROM network_podcasts np
    JOIN podcasts p ON p.id = np.podcast_id
    WHERE np.network_id = ?
    ORDER BY np.position, p.title
  `).all(id)
  return { ...network, podcasts }
})
