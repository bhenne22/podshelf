import { defineEventHandler, getRouterParam } from 'h3'
import { requireNetworkReadAccess } from '../../../utils/auth'
import { coercePropertyValue, type PropertyType } from '../../../utils/network-properties'
import getDb from '../../../db/index'

/**
 * GET /api/networks/[slug]/properties
 *
 * Flat list of values across the network's roster. INNER JOINs against
 * network_property_definitions so orphan keys (left behind by a deleted
 * def) are dropped from the response. Scoped API keys see only values for
 * podcasts inside their scope.
 */
export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug') as string
  const { effectivePodcastIds } = requireNetworkReadAccess(event, slug)

  if (effectivePodcastIds.length === 0) return { properties: [] }

  const db = getDb()
  const placeholders = effectivePodcastIds.map(() => '?').join(',')
  const rows = db.prepare(`
    SELECT npp.podcast_id, p.slug AS podcast_slug,
           npp.key, npp.value, npd.type
    FROM network_podcast_properties npp
    JOIN network_property_definitions npd
      ON npd.network_id = npp.network_id AND npd.key = npp.key
    JOIN podcasts p ON p.id = npp.podcast_id
    WHERE npp.network_id = (SELECT id FROM networks WHERE slug = ?)
      AND npp.podcast_id IN (${placeholders})
      AND p.status = 'active'
    ORDER BY p.title, npd.position, npp.key
  `).all(slug, ...effectivePodcastIds) as {
    podcast_id: number; podcast_slug: string;
    key: string; value: string | null; type: string;
  }[]

  return {
    properties: rows.map((r) => ({
      podcast_id: r.podcast_id,
      podcast_slug: r.podcast_slug,
      key: r.key,
      value: coercePropertyValue(r.type as PropertyType, r.value),
      type: r.type,
    })),
  }
})
