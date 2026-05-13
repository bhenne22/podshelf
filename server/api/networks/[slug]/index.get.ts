import { defineEventHandler, getRouterParam, getQuery } from 'h3'
import { requireNetworkReadAccess } from '../../../utils/auth'
import { coercePropertyValue, type PropertyType } from '../../../utils/network-properties'
import getDb from '../../../db/index'

/**
 * GET /api/networks/[slug]
 *
 * Network detail including roster of active podcasts (ordered by position,
 * then title). Soft-deleted podcasts are omitted but their network_podcasts
 * row stays so a future restore re-attaches them automatically.
 *
 * Optional ?include=properties — attaches a `properties: { key: value }` map
 * to each podcast, typed via the network's property definitions. Values for
 * podcasts outside a scoped API key's reach are dropped (the roster itself
 * is not narrowed; only the values are scope-filtered, matching the
 * upcoming-episodes precedent).
 */
export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { networkId, effectivePodcastIds } = requireNetworkReadAccess(event, slug)

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
  `).all(networkId) as {
    id: number; slug: string; title: string;
    image_url: string | null; timezone: string; position: number;
    properties?: Record<string, string | number | boolean | null>;
  }[]

  const query = getQuery(event)
  const includeProperties = String(query.include || '')
    .split(',')
    .map((s) => s.trim())
    .includes('properties')

  if (includeProperties && podcasts.length > 0 && effectivePodcastIds.length > 0) {
    const placeholders = effectivePodcastIds.map(() => '?').join(',')
    const valueRows = db.prepare(`
      SELECT npp.podcast_id, npp.key, npp.value, npd.type
      FROM network_podcast_properties npp
      JOIN network_property_definitions npd
        ON npd.network_id = npp.network_id AND npd.key = npp.key
      WHERE npp.network_id = ? AND npp.podcast_id IN (${placeholders})
    `).all(networkId, ...effectivePodcastIds) as {
      podcast_id: number; key: string; value: string | null; type: string;
    }[]

    const byPodcast = new Map<number, Record<string, string | number | boolean | null>>()
    for (const row of valueRows) {
      let bucket = byPodcast.get(row.podcast_id)
      if (!bucket) {
        bucket = {}
        byPodcast.set(row.podcast_id, bucket)
      }
      bucket[row.key] = coercePropertyValue(row.type as PropertyType, row.value)
    }
    for (const p of podcasts) {
      if (effectivePodcastIds.includes(p.id)) {
        p.properties = byPodcast.get(p.id) || {}
      }
    }
  }

  return { ...network, podcasts }
})
