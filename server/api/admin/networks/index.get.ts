import { defineEventHandler } from 'h3'
import { requireAdmin } from '../../../utils/auth'
import getDb from '../../../db/index'

/**
 * GET /api/admin/networks
 *
 * Admin list of every network with its current active-podcast count.
 */
export default defineEventHandler((event) => {
  requireAdmin(event)
  const db = getDb()
  return db.prepare(`
    SELECT n.id, n.slug, n.title, n.description, n.created_at, n.updated_at,
           (SELECT COUNT(*) FROM network_podcasts np
            JOIN podcasts p ON p.id = np.podcast_id
            WHERE np.network_id = n.id AND p.status = 'active') AS podcast_count
    FROM networks n
    ORDER BY n.title
  `).all()
})
