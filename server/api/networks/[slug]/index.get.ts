import { defineEventHandler, getRouterParam } from 'h3'
import { requireNetworkReadAccess } from '../../../utils/auth'
import getDb from '../../../db/index'

/**
 * GET /api/networks/[slug]
 *
 * Network detail including roster of active podcasts (ordered by position,
 * then title). Soft-deleted podcasts are omitted but their network_podcasts
 * row stays so a future restore re-attaches them automatically.
 */
export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { networkId } = requireNetworkReadAccess(event, slug)

  const db = getDb()
  const network = db.prepare(`
    SELECT id, slug, title, description, created_at, updated_at
    FROM networks WHERE id = ?
  `).get(networkId) as {
    id: number; slug: string; title: string; description: string | null;
    created_at: string; updated_at: string;
  }

  const podcasts = db.prepare(`
    SELECT p.id, p.slug, p.title, p.image_url, p.timezone, np.position
    FROM network_podcasts np
    JOIN podcasts p ON p.id = np.podcast_id
    WHERE np.network_id = ? AND p.status = 'active'
    ORDER BY np.position, p.title
  `).all(networkId)

  return { ...network, podcasts }
})
